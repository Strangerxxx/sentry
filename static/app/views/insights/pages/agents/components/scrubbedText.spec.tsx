import {OrganizationFixture} from 'sentry-fixture/organization';
import {ProjectFixture} from 'sentry-fixture/project';

import {render, screen, userEvent} from 'sentry-test/reactTestingLibrary';

import {
  getScrubbedPlaceholders,
  SCRUBBING_META_ATTRIBUTE,
  ScrubbedPlaceholdersProvider,
  ScrubbedText,
} from 'sentry/views/insights/pages/agents/components/scrubbedText';
import type {AITraceSpanNode} from 'sentry/views/insights/pages/agents/utils/types';

const INPUT = '[{"role":"user","content":"Find the account for [email]"}]';
const START = INPUT.indexOf('[email]');

function makeNode(rem: Array<[string, string, number, number]>): AITraceSpanNode {
  return {
    errors: new Set(),
    projectSlug: 'project-slug',
    attributes: {
      'gen_ai.input.messages': INPUT,
      [SCRUBBING_META_ATTRIBUTE]: JSON.stringify({
        'gen_ai.input.messages': {meta: {value: {'': {rem, len: 0}}}},
      }),
    },
  } as unknown as AITraceSpanNode;
}

describe('getScrubbedPlaceholders', () => {
  it('resolves replacement texts from the remarks', () => {
    const node = makeNode([['@email:replace', 's', START, START + '[email]'.length]]);

    expect(getScrubbedPlaceholders([node])).toEqual(
      new Map([
        ['[email]', {remark: 's', ruleId: '@email:replace', projectSlug: 'project-slug'}],
      ])
    );
  });

  it('ignores ranges that do not cover a replacement text', () => {
    const node = makeNode([['@email:replace', 's', 0, 7]]);

    expect(getScrubbedPlaceholders([node]).size).toBe(0);
  });
});

describe('ScrubbedText', () => {
  it('explains replacement texts in a tooltip linking to the settings', async () => {
    const organization = OrganizationFixture();
    const project = ProjectFixture();
    MockApiClient.addMockResponse({
      url: `/projects/${organization.slug}/${project.slug}/`,
      body: project,
    });

    render(
      <ScrubbedPlaceholdersProvider
        value={
          new Map([
            [
              '[email]',
              {remark: 's', ruleId: '@email:replace', projectSlug: project.slug},
            ],
          ])
        }
      >
        <ScrubbedText>Find the account for [email] and summarise it.</ScrubbedText>
      </ScrubbedPlaceholdersProvider>,
      {organization}
    );

    await userEvent.hover(screen.getByText('[email]'));

    expect(await screen.findByRole('link', {name: project.slug})).toHaveAttribute(
      'href',
      `/settings/${organization.slug}/projects/${project.slug}/security-and-privacy/`
    );
  });

  it('renders plain text without scrubbed placeholders', () => {
    render(<ScrubbedText>Contact [email] here</ScrubbedText>);

    expect(screen.getByText('Contact [email] here')).toBeInTheDocument();
  });
});
