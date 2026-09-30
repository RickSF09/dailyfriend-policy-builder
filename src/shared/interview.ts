// The interview: every question the builder can ask, in order, and when each
// one applies. The model never chooses what to ask next; engine.ts does, from
// this list. The model only reads free-text answers (see server/turn.ts).
//
// Shared by the browser and the server, so it must stay free of Node- and
// DOM-specific code.

import { TOOLS, USES } from './knowledge.generated.js';

/** Stored when someone taps "Not sure" or skips. The policy shows a [TO DECIDE] gap. */
export const UNSURE = '__unsure';

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue>;

export type TopicId = 'org' | 'current' | 'uses' | 'data' | 'roles' | 'people' | 'staff' | 'signoff';

export const TOPICS: { id: TopicId; title: string }[] = [
  { id: 'org', title: 'Your organisation' },
  { id: 'current', title: 'AI tools today' },
  { id: 'uses', title: 'What AI is for' },
  { id: 'data', title: 'Data protection' },
  { id: 'roles', title: 'Who does what' },
  { id: 'people', title: 'People you support' },
  { id: 'staff', title: 'Staff' },
  { id: 'signoff', title: 'Sign-off' },
];

export interface Option {
  id: string;
  label: string;
  /** Said back after this option is chosen. Keeps chip answers conversational without a model call. */
  ack?: string;
}

export interface Slot {
  id: string;
  topic: TopicId;
  kind: 'choice' | 'multi' | 'text';
  question: string;
  /** Short label for the review screen. */
  label: string;
  /** Rewords the question using earlier answers, e.g. to name their tools. */
  questionFor?: (a: Answers) => string | undefined;
  /** "Why we ask", shown on request. */
  help?: string;
  options?: Option[];
  /**
   * Tap-to-answer suggestions for text slots. "$me" means the person's own
   * role; "$owner" means the same as the policy owner.
   */
  suggestions?: string[];
  placeholder?: string;
  maxLength?: number;
  /** Optional slots offer "Skip" rather than "Not sure". */
  optional?: boolean;
  /**
   * A decision the policy turns on. Only ever recorded when it is the question
   * being asked, never picked up in passing from an answer to something else.
   */
  askDirectly?: boolean;
  when?: (a: Answers) => boolean;
}

// ---------------------------------------------------------------------------
// Reading answers
// ---------------------------------------------------------------------------

export const isUnsure = (v: AnswerValue | undefined) => v === UNSURE;

export function list(a: Answers, id: string): string[] {
  const v = a[id];
  return Array.isArray(v) ? v : [];
}

export function text(a: Answers, id: string): string {
  const v = a[id];
  return typeof v === 'string' && v !== UNSURE ? v : '';
}

export const is = (a: Answers, id: string, value: string) => a[id] === value;

/** Tools picked from the directory (not "other" or "none"). */
export function directoryTools(a: Answers): string[] {
  return list(a, 'tools').filter((t) => TOOLS.some((x) => x.id === t));
}

const CARE_USES = new Set(USES.filter((u) => u.readiness === 'care').map((u) => u.id));

/**
 * Will information about a person go into AI? Yes if a chosen task needs it,
 * if they said so, or if they are unsure: the safe reading of "not sure".
 */
export function usesPersonalData(a: Answers): boolean {
  // AI built into care systems always works on information about people.
  if (embeddedAi(a).length) return true;
  if (!allowsAi(a)) return false;
  if (list(a, 'tasks').some((t) => CARE_USES.has(t))) return true;
  return a.personalData === 'yes' || isUnsure(a.personalData);
}

/** False when the organisation's stance is "no AI for work, for now". */
export const allowsAi = (a: Answers) => a.stance !== 'none';

const EMBEDDED_NAMES: Record<string, string> = {
  'care-records': 'your care records system',
  emar: 'your eMAR system',
  rostering: 'your rota system',
  monitoring: 'your monitoring technology',
  pain: 'your assessment app',
  recruitment: 'your recruitment software',
};

/** AI features in systems they already use (not "none"). */
export const embeddedAi = (a: Answers) => list(a, 'embedded').filter((e) => e !== 'none');

export const usesMonitoring = (a: Answers) => embeddedAi(a).some((e) => e === 'monitoring' || e === 'pain');

const aiInUse = (a: Answers) => a.aiInUse === 'approved' || a.aiInUse === 'informal';
const hasTools = (a: Answers) => allowsAi(a) && list(a, 'tools').some((t) => t !== 'none');

// ---------------------------------------------------------------------------
// Plans. "Which kind of account" matters more than which tool.
// ---------------------------------------------------------------------------

const PLAN_NAMES: Record<string, { personal: string; business: string }> = {
  chatgpt: { personal: 'Plus or Pro', business: 'Business or Enterprise' },
  claude: { personal: 'Pro or Max', business: 'Team or Enterprise' },
  'google-gemini': { personal: 'a personal Google account', business: 'Google Workspace' },
  'microsoft-copilot': { personal: 'Copilot Pro', business: 'Microsoft 365 for business' },
  grammarly: { personal: 'Premium', business: 'Business or Enterprise' },
  otter: { personal: 'Pro', business: 'Business or Enterprise' },
};

export function toolName(id: string): string {
  if (id === 'other') return 'the other tool';
  return TOOLS.find((t) => t.id === id)?.name ?? id;
}

function planSlot(toolId: string): Slot {
  const names = PLAN_NAMES[toolId];
  const name = toolId === 'other' ? 'the other tools' : toolName(toolId);
  return {
    id: `plan:${toolId}`,
    topic: 'current',
    kind: 'choice',
    label: toolId === 'other' ? 'Other tools: account' : `${toolName(toolId)}: account`,
    question: `What kind of account is ${name} used on?`,
    help: 'This matters more than the tool itself. Personal plans, free or paid, come without a data processing agreement, so nothing about a person can go into them. Business plans usually come with one.',
    options: [
      { id: 'free', label: 'Free personal account' },
      {
        id: 'personal-paid',
        label: names ? `Paid personal plan (${names.personal})` : 'Paid personal plan',
        ack: 'Worth knowing: a paid personal plan is still a personal plan. It has no data processing agreement.',
      },
      {
        id: 'business',
        label: names
          ? `Work account on a business plan (${names.business})`
          : 'Work account on a business plan',
      },
      { id: 'mixed', label: 'A mix: some people on each' },
    ],
  };
}

// ---------------------------------------------------------------------------
// The questions
// ---------------------------------------------------------------------------

const YES_NO: Option[] = [
  { id: 'yes', label: 'Yes' },
  { id: 'no', label: 'No' },
];

export const SLOTS: Slot[] = [
  // Your organisation
  {
    id: 'orgName',
    topic: 'org',
    kind: 'text',
    label: 'Organisation name',
    question: 'Let’s start with the basics. What is your organisation called?',
    placeholder: 'e.g. Riverside Home Care',
    help: 'It goes on the policy. Your answers stay in this browser; our server only sees them while it is writing a reply, and keeps nothing.',
    maxLength: 120,
  },
  {
    id: 'yourRole',
    topic: 'org',
    kind: 'text',
    label: 'Your role',
    question: 'And what is your role there?',
    help: 'So that when you say "me" later, the policy can name the role. It does not appear in the policy on its own.',
    suggestions: ['Registered Manager', 'Chief Executive', 'Operations Manager', 'Owner'],
    maxLength: 80,
  },
  {
    id: 'orgType',
    topic: 'org',
    kind: 'multi',
    label: 'Services',
    question: 'What kind of service do you run? Pick all that apply.',
    options: [
      { id: 'domiciliary', label: 'Home care (domiciliary)' },
      { id: 'supported-living', label: 'Supported living' },
      { id: 'residential', label: 'Residential care home' },
      { id: 'nursing', label: 'Nursing home' },
      { id: 'day', label: 'Day service' },
      { id: 'extra-care', label: 'Extra care housing' },
      { id: 'community', label: 'Community or charity support' },
      { id: 'other', label: 'Something else' },
    ],
  },
  {
    id: 'orgTypeOther',
    topic: 'org',
    kind: 'text',
    label: 'Other services',
    question: 'What else do you provide?',
    maxLength: 200,
    when: (a) => list(a, 'orgType').includes('other'),
  },
  {
    id: 'staffSize',
    topic: 'org',
    kind: 'choice',
    label: 'Size',
    question: 'Roughly how many people work or volunteer for you?',
    options: [
      { id: '1-10', label: '1 to 10' },
      { id: '11-50', label: '11 to 50' },
      { id: '51-250', label: '51 to 250' },
      { id: '250+', label: 'More than 250' },
    ],
  },
  {
    id: 'nations',
    topic: 'org',
    kind: 'multi',
    label: 'Where you work',
    question: 'Where do you provide services?',
    help: 'Each nation has its own care regulator, and the policy names yours.',
    options: [
      { id: 'england', label: 'England' },
      { id: 'wales', label: 'Wales' },
      { id: 'scotland', label: 'Scotland' },
      { id: 'ni', label: 'Northern Ireland' },
    ],
  },
  {
    id: 'nhs',
    topic: 'org',
    kind: 'choice',
    label: 'NHS contracts or DSPT',
    question: 'Do you have NHS contracts, or complete the Data Security and Protection Toolkit (DSPT)?',
    help: 'If you do, your DSPT return covers how you control access to data and which suppliers handle it, so the policy links the two.',
    options: YES_NO,
    when: (a) => list(a, 'nations').includes('england'),
  },

  // AI tools today
  {
    id: 'stance',
    askDirectly: true,
    topic: 'current',
    kind: 'choice',
    label: 'Your stance on AI',
    question: 'Which best describes where you want to be with AI?',
    help: 'The government’s guidance says every care provider should have an AI policy, even if the policy is that staff cannot use AI for work. All three are reasonable; the policy follows your choice.',
    options: [
      {
        id: 'none',
        label: 'No AI for work, for now',
        ack: 'That is a clear position. The policy will say so, and still cover AI that turns up inside the software you already use.',
      },
      { id: 'approved', label: 'Only tools we have approved' },
      { id: 'adopt', label: 'Actively use AI where it helps' },
    ],
  },
  {
    id: 'aiInUse',
    topic: 'current',
    kind: 'choice',
    label: 'AI in use now',
    question:
      'Is anyone in your organisation using AI tools for work at the moment, such as ChatGPT or Copilot?',
    options: [
      { id: 'approved', label: 'Yes, tools we have agreed on' },
      {
        id: 'informal',
        label: 'Yes, informally: people use what they like',
        ack: 'That is where most organisations are. The policy brings it into the open rather than pretending it is not happening.',
      },
      { id: 'none', label: 'Not that I know of' },
    ],
  },
  {
    id: 'tools',
    topic: 'current',
    kind: 'multi',
    label: 'Tools',
    question: 'Which AI tools are used now, or do you plan to use? Pick all that apply.',
    when: allowsAi,
    help: 'The policy lists each approved tool by name, with the account it must be used on. "Anything not on the list is not approved" only works if the list exists.',
    options: [
      ...TOOLS.map((t) => ({ id: t.id, label: t.name })),
      { id: 'other', label: 'Another tool' },
      { id: 'none', label: 'None yet' },
    ],
  },
  {
    id: 'toolsOther',
    topic: 'current',
    kind: 'text',
    label: 'Other tools',
    question: 'Which other tools? Just the names is fine.',
    placeholder: 'e.g. Birdie, Copilot in our care software',
    maxLength: 200,
    when: (a) => allowsAi(a) && list(a, 'tools').includes('other'),
  },
  // plan:<tool> slots are inserted here by visibleSlots()
  {
    id: 'embedded',
    topic: 'current',
    kind: 'multi',
    label: 'AI built into your systems',
    question:
      'Apart from separate AI tools, do any systems you already use have AI features built in, such as your care records or rota software? Pick any that apply.',
    help: 'AI inside software you already pay for counts too, and it often arrives in an update without anyone deciding to use it. It works on information about people, so the same rules apply.',
    options: [
      { id: 'care-records', label: 'Digital care records, e.g. AI summaries or suggested notes' },
      { id: 'emar', label: 'Medication records (eMAR)' },
      { id: 'rostering', label: 'Rostering or scheduling' },
      { id: 'monitoring', label: 'Sensors, or acoustic, video or movement monitoring' },
      { id: 'pain', label: 'Pain or health assessment apps' },
      { id: 'recruitment', label: 'Recruitment or HR software' },
      { id: 'none', label: 'None that I know of' },
    ],
  },
  {
    id: 'monitoringConsent',
    askDirectly: true,
    topic: 'current',
    kind: 'choice',
    label: 'Consent for monitoring',
    question:
      'How do you decide whether monitoring or assessment technology is used for a particular person?',
    help: 'Monitoring someone affects their privacy and dignity. It needs their agreement or, where they lack capacity for that decision, a recorded best interests decision, person by person.',
    options: [
      { id: 'consent', label: 'We ask them and record their agreement' },
      {
        id: 'mca',
        label: 'Their agreement, or a capacity assessment and best interests decision where needed',
      },
      { id: 'none', label: 'We have no set process yet' },
    ],
    when: usesMonitoring,
  },
  {
    id: 'personalAccounts',
    topic: 'current',
    kind: 'choice',
    label: 'Personal accounts used for work',
    question: 'Do any staff use AI on their own personal accounts or phones for work, even occasionally?',
    help: 'This is the most common gap. A personal account is outside your control entirely, and on screen it looks identical to a work one.',
    options: [
      {
        id: 'yes',
        label: 'Yes',
        ack: 'Thanks. That is the most common gap, and the action plan will start there.',
      },
      { id: 'no', label: 'No' },
    ],
    when: (a) => a.aiInUse !== 'none',
  },
  {
    id: 'personalDataEntered',
    askDirectly: true,
    topic: 'current',
    kind: 'choice',
    label: 'Personal information already entered',
    question:
      'As far as you know, has anything about a person you support ever been put into an AI tool, even without their name?',
    options: [
      {
        id: 'yes',
        label: 'Yes',
        ack: 'Thank you for being straight about it. The action plan covers what to do, calmly and without blame.',
      },
      { id: 'no', label: 'No' },
    ],
    when: aiInUse,
  },
  {
    id: 'accountRule',
    askDirectly: true,
    topic: 'current',
    kind: 'choice',
    label: 'Personal accounts rule',
    question:
      'Some organisations let staff use free or personal AI accounts for work that never involves a person, like job adverts. Others allow work accounts only. Which do you want?',
    help: 'Both are defensible. Work accounts only is simpler to follow and to check. Allowing personal accounts for general tasks is realistic if you have no business plans yet, but nothing about any person may ever go into them.',
    options: [
      { id: 'work-only', label: 'Work accounts only' },
      { id: 'general-only', label: 'Personal accounts allowed for tasks with no information about anyone' },
    ],
    when: allowsAi,
  },

  // What AI is for
  {
    id: 'tasks',
    topic: 'uses',
    kind: 'multi',
    label: 'Tasks',
    question: 'What do you use AI for, or want to? Pick all that apply.',
    help: 'Some tasks never involve a person (job adverts, funding bids). Others always do (visit notes, care plans), and need more safeguards. The policy treats them differently.',
    options: [
      ...USES.filter((u) => u.readiness !== 'not-yet').map((u) => ({ id: u.id, label: u.title })),
      { id: 'other', label: 'Something else' },
    ],
    when: allowsAi,
  },
  {
    id: 'tasksOther',
    topic: 'uses',
    kind: 'text',
    label: 'Other tasks',
    question: 'What else would you use it for?',
    maxLength: 300,
    when: (a) => allowsAi(a) && list(a, 'tasks').includes('other'),
  },
  {
    id: 'personalData',
    topic: 'uses',
    kind: 'choice',
    label: 'Personal information in AI',
    question: 'Will anything about the people you support, or about staff, go into an AI tool?',
    options: [
      { id: 'no', label: 'No, general tasks only' },
      { id: 'yes', label: 'Yes' },
    ],
    // A task that needs personal data already answers this.
    when: (a) => allowsAi(a) && !embeddedAi(a).length && !list(a, 'tasks').some((t) => CARE_USES.has(t)),
  },
  {
    id: 'redLines',
    topic: 'uses',
    kind: 'text',
    label: 'Your own red lines',
    question:
      'Is there anything else you never want AI used for here? The policy already rules out decisions about care, risk, eligibility and safeguarding.',
    placeholder: 'e.g. writing to families after a death',
    maxLength: 300,
    optional: true,
  },

  // Data protection
  {
    id: 'dpa',
    askDirectly: true,
    topic: 'data',
    kind: 'choice',
    label: 'Data processing agreements',
    question:
      'For the tools and systems that handle personal information, do you have a data processing agreement (DPA) with each supplier?',
    questionFor: (a) => {
      const names = [
        ...list(a, 'tools')
          .filter((t) => t !== 'none' && !['free', 'personal-paid'].includes(String(a[`plan:${t}`])))
          .map((t) => (t === 'other' ? text(a, 'toolsOther') || 'the other tool' : toolName(t))),
        ...embeddedAi(a).map((e) => EMBEDDED_NAMES[e] ?? e),
      ];
      if (!names.length) return undefined;
      const which =
        names.length === 1 ? names[0] : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
      return `Do you have a data processing agreement (DPA) with the supplier of ${names.length === 1 ? '' : 'each of '}${which}?`;
    },
    help: 'A DPA is the contract that says the supplier only uses your data on your instructions. Without one there is no lawful footing for putting personal information into the tool. Business plans usually include one; personal plans never do.',
    options: [
      { id: 'yes', label: 'Yes, for all of them' },
      { id: 'some', label: 'For some' },
      { id: 'no', label: 'No' },
    ],
    when: (a) => usesPersonalData(a) && (hasTools(a) || embeddedAi(a).length > 0),
  },
  {
    id: 'dpia',
    askDirectly: true,
    topic: 'data',
    kind: 'choice',
    label: 'DPIA',
    question: 'Have you done a data protection impact assessment (DPIA) for your use of AI?',
    help: 'For AI touching information about people you support, you almost certainly need one, and before you start rather than after. CQC names it in its principles for AI.',
    options: [
      { id: 'done', label: 'Yes, done' },
      { id: 'in-progress', label: 'Started' },
      { id: 'no', label: 'No' },
    ],
    when: usesPersonalData,
  },
  {
    id: 'dpLead',
    topic: 'data',
    kind: 'text',
    label: 'Data protection lead',
    question: 'Who leads on data protection in your organisation? A role is fine.',
    suggestions: ['$me', 'Registered Manager', 'Data Protection Officer', 'Operations Manager'],
    maxLength: 120,
  },
  {
    id: 'breachProcedure',
    askDirectly: true,
    topic: 'data',
    kind: 'choice',
    label: 'Data breach procedure',
    question: 'Do you have a written procedure for data breaches?',
    options: YES_NO,
  },

  // Who does what
  {
    id: 'owner',
    topic: 'roles',
    kind: 'text',
    label: 'Policy owner',
    question: 'Who will own this policy and keep it up to date? A role is fine, and you can add a name.',
    suggestions: ['$me', 'Registered Manager', 'Chief Executive', 'Operations Manager'],
    maxLength: 120,
  },
  {
    id: 'approver',
    topic: 'roles',
    kind: 'text',
    label: 'Approves new tools',
    question: 'Who decides whether a new AI tool can be used?',
    suggestions: ['$me', '$owner', 'Registered Manager', 'The board'],
    maxLength: 120,
  },
  {
    id: 'checker',
    askDirectly: true,
    topic: 'roles',
    kind: 'text',
    label: 'Spot-checks AI output',
    question:
      'Everyone checks their own AI drafts. Besides that, who will spot-check AI-produced work to make sure the checking happens?',
    help: 'CQC expects AI outputs to be "continuously monitored and evaluated". That means someone named, on an ongoing basis, not only during a trial.',
    suggestions: ['$me', '$owner', 'Care Coordinator', 'Deputy Manager'],
    maxLength: 120,
  },
  {
    id: 'checkRate',
    askDirectly: true,
    topic: 'roles',
    kind: 'choice',
    label: 'How often',
    question: 'How often will they spot-check?',
    help: 'Promise only what you will actually do. A monthly check that happens is worth more than a weekly one that does not.',
    options: [
      { id: 'weekly', label: 'Weekly, a small sample' },
      { id: 'monthly', label: 'Monthly' },
      { id: 'quarterly', label: 'Every three months' },
    ],
  },
  {
    id: 'reportTo',
    topic: 'roles',
    kind: 'text',
    label: 'Report problems to',
    question: 'If something goes wrong with AI, who should staff tell?',
    suggestions: ['$me', '$owner', 'Their line manager', 'Registered Manager'],
    maxLength: 120,
  },
  {
    id: 'reportHow',
    askDirectly: true,
    topic: 'roles',
    kind: 'choice',
    label: 'How to report',
    question: 'How should they tell them?',
    options: [
      { id: 'person', label: 'In person or by phone' },
      { id: 'email', label: 'By email' },
      { id: 'form', label: 'Our usual incident form' },
      { id: 'any', label: 'Any of these' },
    ],
  },

  // People you support
  {
    id: 'tellPeople',
    topic: 'people',
    kind: 'multi',
    label: 'Telling people',
    question: 'How will you tell the people you support that AI is involved? Pick all that apply.',
    help: 'The ICO requires you to tell people before a new use of their data starts, not afterwards.',
    options: [
      { id: 'letter', label: 'A short letter' },
      { id: 'review', label: 'At their next review' },
      { id: 'welcome', label: 'In the welcome pack' },
      { id: 'privacy', label: 'Update our privacy notice' },
    ],
    when: usesPersonalData,
  },
  {
    id: 'optOut',
    askDirectly: true,
    topic: 'people',
    kind: 'choice',
    label: 'If someone objects',
    question: 'If someone does not want AI involved in their records, what could you realistically do?',
    options: [
      { id: 'alternative', label: 'Keep doing it without AI for them' },
      { id: 'case', label: 'Decide case by case' },
      {
        id: 'cannot',
        label: 'We could not offer an alternative',
        ack: 'An honest answer makes a better policy. It will say you will listen, record the objection and explain your decision.',
      },
    ],
    when: usesPersonalData,
  },
  {
    id: 'capacity',
    topic: 'people',
    kind: 'choice',
    label: 'People who may lack capacity',
    question: 'Do you support people who may lack capacity to make some decisions?',
    options: YES_NO,
    when: usesPersonalData,
  },

  // Staff
  {
    id: 'workforce',
    topic: 'staff',
    kind: 'multi',
    label: 'Who it applies to',
    question: 'Who should the policy apply to? Pick all that apply.',
    options: [
      { id: 'employed', label: 'Employed staff' },
      { id: 'bank', label: 'Bank staff' },
      { id: 'agency', label: 'Agency staff' },
      { id: 'volunteers', label: 'Volunteers' },
      { id: 'board', label: 'Trustees or directors' },
    ],
  },
  {
    id: 'training',
    askDirectly: true,
    topic: 'staff',
    kind: 'choice',
    label: 'Training',
    question: 'Will staff get training on AI and on this policy?',
    options: [
      { id: 'planned', label: 'Yes, it is planned' },
      { id: 'induction', label: 'We will add it to induction' },
      { id: 'no', label: 'Not yet' },
    ],
  },
  {
    id: 'ownDevices',
    topic: 'staff',
    kind: 'choice',
    label: 'Own phones for work',
    question: 'Do staff use their own phones for work, for example for rotas or messages?',
    options: [
      { id: 'yes', label: 'Yes' },
      { id: 'some', label: 'Some do' },
      { id: 'no', label: 'No, work phones only' },
    ],
  },

  // Sign-off
  {
    id: 'signoffBy',
    askDirectly: true,
    topic: 'signoff',
    kind: 'choice',
    label: 'Signed off by',
    question: 'Who will sign the policy off?',
    options: [
      { id: 'trustees', label: 'The board of trustees' },
      { id: 'directors', label: 'The directors' },
      { id: 'owner', label: 'The owner' },
      { id: 'manager', label: 'The registered manager' },
    ],
  },
  {
    id: 'reviewMonths',
    askDirectly: true,
    topic: 'signoff',
    kind: 'choice',
    label: 'Review',
    question: 'When should it be reviewed?',
    help: 'No more than a year. Suppliers change their terms without telling you.',
    options: [
      { id: '6', label: 'In 6 months' },
      { id: '12', label: 'In 12 months' },
    ],
  },
];

const BY_ID = new Map(SLOTS.map((s) => [s.id, s]));

/** Any slot by id, including plan:<tool> slots. */
export function getSlot(id: string): Slot | undefined {
  const fixed = BY_ID.get(id);
  if (fixed) return fixed;
  const m = /^plan:(.+)$/.exec(id);
  if (m?.[1] && (m[1] === 'other' || TOOLS.some((t) => t.id === m[1]))) return planSlot(m[1]);
  return undefined;
}

/** The questions that apply to these answers, in the order they are asked. */
export function visibleSlots(a: Answers): Slot[] {
  const out: Slot[] = [];
  for (const slot of SLOTS) {
    if (slot.when && !slot.when(a)) continue;
    const reworded = slot.questionFor?.(a);
    out.push(reworded ? { ...slot, question: reworded } : slot);
    const toolsDone =
      slot.id === 'toolsOther' || (slot.id === 'tools' && !list(a, 'tools').includes('other'));
    if (toolsDone && allowsAi(a)) {
      for (const t of list(a, 'tools')) {
        if (t !== 'none') out.push(planSlot(t));
      }
    }
  }
  return out;
}
