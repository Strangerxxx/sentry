import {createContext, Fragment, useContext, useMemo} from 'react';
import escapeRegExp from 'lodash/escapeRegExp';

import {InfoText} from '@sentry/scraps/info';

import {getTooltipText} from 'sentry/components/events/meta/annotatedText/utils';
import {useDetailedProject} from 'sentry/utils/project/useDetailedProject';
import {useOrganization} from 'sentry/utils/useOrganization';
import type {TraceItemDetailsMeta} from 'sentry/views/explore/hooks/useTraceItemDetails';
import {TraceItemMetaInfo} from 'sentry/views/explore/utils';
import {getStringAttr} from 'sentry/views/insights/pages/agents/utils/aiTraceNodes';
import type {AITraceSpanNode} from 'sentry/views/insights/pages/agents/utils/types';

/** The node attribute that holds the conversation endpoint's `meta`, as JSON. */
export const SCRUBBING_META_ATTRIBUTE = 'sentry._meta';

// Relay's replacements are bracketed, like `[email]` or `[Filtered]`. A range that
// doesn't cover one doesn't line up with the value, so it's ignored.
const PLACEHOLDER_PATTERN = /^\[[^[\]\s]+\]$/;

interface ScrubbedPlaceholder {
  projectSlug: string | undefined;
  remark: string;
  ruleId: string;
}

/** Replacement texts that Relay inserted, like `[email]`, with the rule that did it. */
type ScrubbedPlaceholders = ReadonlyMap<string, ScrubbedPlaceholder>;

const ScrubbedPlaceholdersContext = createContext<ScrubbedPlaceholders>(new Map());

/** Marks the replacement texts in the AI content rendered below it as scrubbed. */
export const ScrubbedPlaceholdersProvider = ScrubbedPlaceholdersContext.Provider;

export function useHasScrubbedPlaceholders(): boolean {
  return useContext(ScrubbedPlaceholdersContext).size > 0;
}

/** The remarks' ranges point into the stored values, so `getValue` must return those. */
export function resolveScrubbedPlaceholders(
  meta: TraceItemDetailsMeta | undefined,
  getValue: (attribute: string) => unknown,
  projectSlug: string | undefined,
  placeholders = new Map<string, ScrubbedPlaceholder>()
): Map<string, ScrubbedPlaceholder> {
  if (!meta) {
    return placeholders;
  }
  const metaInfo = new TraceItemMetaInfo(meta);
  for (const attribute of Object.keys(meta)) {
    const value = getValue(attribute);
    if (typeof value !== 'string') {
      continue;
    }
    for (const {ruleId, type, rangeStart, rangeEnd} of metaInfo.getRemarks(attribute)) {
      const text = value.slice(rangeStart, rangeEnd);
      if (PLACEHOLDER_PATTERN.test(text)) {
        placeholders.set(text, {remark: type, ruleId, projectSlug});
      }
    }
  }
  return placeholders;
}

/**
 * Resolve from the nodes as stored, before the transcript moves messages between
 * nodes, so the ranges still line up.
 */
export function getScrubbedPlaceholders(nodes: AITraceSpanNode[]): ScrubbedPlaceholders {
  const placeholders = new Map<string, ScrubbedPlaceholder>();
  for (const node of nodes) {
    const meta = getStringAttr(node, SCRUBBING_META_ATTRIBUTE);
    if (meta) {
      resolveScrubbedPlaceholders(
        JSON.parse(meta),
        attribute => getStringAttr(node, attribute),
        node.projectSlug,
        placeholders
      );
    }
  }
  return placeholders;
}

/** Renders text with a tooltip on each replacement text PII scrubbing inserted, like `[email]`. */
export function ScrubbedText({children}: {children: string}) {
  const placeholders = useContext(ScrubbedPlaceholdersContext);

  const pattern = useMemo(
    () =>
      placeholders.size === 0
        ? null
        : new RegExp(`(${Array.from(placeholders.keys(), escapeRegExp).join('|')})`),
    [placeholders]
  );

  if (!pattern) {
    return <Fragment>{children}</Fragment>;
  }

  // The capturing group keeps the placeholders, at the odd indices.
  return (
    <Fragment>
      {children.split(pattern).map((part, index) => {
        const placeholder = index % 2 === 1 ? placeholders.get(part) : undefined;
        if (!placeholder) {
          return part;
        }
        return (
          <InfoText
            key={index}
            variant="inherit"
            title={<ScrubbedTooltip placeholder={placeholder} />}
          >
            {part}
          </InfoText>
        );
      })}
    </Fragment>
  );
}

/** Rendered only while the tooltip is open, so the project is fetched on hover. */
function ScrubbedTooltip({placeholder}: {placeholder: ScrubbedPlaceholder}) {
  const organization = useOrganization({allowNull: true}) ?? undefined;
  // The project's rules, in `relayPiiConfig`, aren't in the store.
  const {data: project} = useDetailedProject(
    {orgSlug: organization?.slug ?? '', projectSlug: placeholder.projectSlug ?? ''},
    {enabled: Boolean(organization && placeholder.projectSlug)}
  );

  return getTooltipText({
    remark: placeholder.remark,
    rule_id: placeholder.ruleId,
    organization,
    project,
  });
}
