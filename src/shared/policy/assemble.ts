// Builds the policy from the answers. The wording is fixed and reviewed; the
// answers decide which clauses appear and fill in names, roles and tools. The
// model contributes at most a purpose paragraph and one example sentence per
// task (Snippets), and each of those has a default here.
//
// Sources for the wording are the hub's checked guides: writing an AI use
// policy, the golden rules, safeguarding and AI, capacity and consent, telling
// people you support, what CQC says about AI, and do you need a DPIA.

import { TOOLS, USES } from '../knowledge.generated.js';
import { prune } from '../engine.js';
import {
  allowsAi,
  type Answers,
  embeddedAi,
  getSlot,
  isUnsure,
  list,
  text,
  usesMonitoring,
  usesPersonalData,
} from '../interview.js';
import { buildActions } from './actions.js';
import { type Block, GAP, type PolicyDoc, type Section, type Snippets } from './types.js';
import {
  capacityLaw,
  capitalise,
  checkRate,
  chosenTools,
  formatDate,
  gap,
  inEngland,
  isPersonalPlan,
  joinList,
  orgName,
  regulators,
  reportHow,
  reviewDate,
  RED_LINES,
  signoffBy,
  TASKS_OTHER,
  type ToolRow,
  usableTools,
  who,
  Who,
  whoCell,
  withWording,
  workforce,
} from './words.js';

/** One sentence per use, shown when the model has not tailored it. */
export const DEFAULT_EXAMPLES: Record<string, string> = {
  'care-plans':
    'Drafting sections of a care and support plan from the assessor’s notes, for the assessor to check against what the person said.',
  'easy-read-letters':
    'Rewriting a letter or leaflet in plainer English or an easy-read style, checking that no choice or right has been dropped.',
  'family-updates':
    'Drafting an update for a family member from the care worker’s notes, for a person to check and send.',
  'funding-bids': 'Drafting sections of a funding bid or impact report from anonymised or total figures.',
  'incident-summaries':
    'Summarising an incident report for a review, keeping the original wording wherever it was strong.',
  'policy-updates': 'Rewriting a policy or procedure into plainer English.',
  'recruitment-adverts': 'Drafting job adverts and interview questions.',
  'referral-summaries':
    'Summarising a long referral so a person can read it faster. The person still reads the referral before anything is decided.',
  'rota-cover': 'Suggesting options to fill gaps in the rota, with a person making the final choice.',
  'visit-notes':
    'Turning a care worker’s spoken summary into a draft visit record, which the care worker checks and corrects before it is saved.',
  'wellbeing-check-ins':
    'Automated wellbeing check-in calls, where anything that needs attention goes straight to a person.',
};

const PLAN_TEXT: Record<string, string> = {
  free: 'Free personal account',
  'personal-paid': 'Paid personal plan',
  business: 'Work account on a business plan',
  mixed: 'Work account on a business plan only',
  unsure: gap('which plan and account'),
};

function toolsSection(a: Answers): Section {
  const org = orgName(a);
  const personal = usesPersonalData(a);
  const rows = allowsAi(a) ? chosenTools(a) : [];
  const rule = a.accountRule;
  const dpaOk = a.dpa === 'yes';
  const dpiaOk = a.dpia === 'done';
  const blocks: Block[] = [];

  function personalInfo(r: ToolRow): string {
    if (isPersonalPlan(r.plan) || r.plan === 'unsure') return 'Never';
    if (r.agreed === 'no') return 'No';
    if (!personal) return 'No';
    if (a.dpa === 'some') return 'Only once its data processing agreement is confirmed';
    if (!dpaOk) return 'Not until a data processing agreement is confirmed';
    if (!dpiaOk) return 'Not until the DPIA is complete';
    return 'Yes, for the tasks in section 5';
  }

  function status(r: ToolRow): string {
    if (isPersonalPlan(r.plan)) {
      if (rule === 'general-only') return 'Approved only for tasks with no information about anyone';
      if (rule === 'work-only') return 'Not approved for work';
      return gap('whether personal accounts are allowed');
    }
    if (r.agreed === 'no') return 'Under review: not approved yet';
    if (r.agreed === 'unknown') return gap(`whether ${r.name} has been agreed`);
    if (r.plan === 'unsure') return 'Not approved until the plan is confirmed';
    return 'Approved';
  }

  if (!allowsAi(a)) {
    blocks.push({
      kind: 'p',
      text: `**AI tools are not approved for work at ${org}.** That includes free and personal accounts, on any device.${embeddedAi(a).length ? ' The only exception is the AI built into the systems listed below, which is covered by the rest of this policy.' : ''} If we decide to use AI in future, it will be through section 12, and this policy will be updated first.`,
    });
  } else if (rows.length) {
    blocks.push({
      kind: 'p',
      text: 'Only the tools below may be used for work, on the accounts shown. **Anything not on this list is not approved.**',
    });
    blocks.push({
      kind: 'table',
      head: ['Tool', 'Account', 'Status', 'Information about people?'],
      rows: rows.map((r) => [r.name, PLAN_TEXT[r.plan] ?? r.plan, status(r), personalInfo(r)]),
    });
    if (rows.some((r) => r.agreed === 'yes' && !isPersonalPlan(r.plan))) {
      blocks.push({
        kind: 'p',
        text: 'Signing off this policy confirms the approvals in this table.',
      });
    }
    const review = rows.filter((r) => r.agreed === 'no' && !isPersonalPlan(r.plan));
    if (review.length) {
      const names = joinList(review.map((r) => r.name));
      blocks.push({
        kind: 'p',
        text: `**${names} ${review.length > 1 ? 'are' : 'is'} under review.** Until ${who(a, 'approver', 'who approves new tools')} decides, through section 12, nobody uses ${review.length > 1 ? 'them' : 'it'} for work, including anyone who already has an account.`,
      });
    }
    for (const r of rows.filter((x) => x.plan === 'mixed' && x.agreed !== 'no')) {
      blocks.push({
        kind: 'p',
        text:
          rule === 'general-only'
            ? `Some staff use ${r.name} on personal accounts. Those accounts may only be used for tasks with no information about anyone; everything else goes through the work account.`
            : `Some staff use ${r.name} on personal accounts. They must move to the work account; personal ${r.name} accounts are not approved for work.`,
      });
    }
    // Facts from the hub's tool directory that change what a tool may be used for.
    for (const r of rows) {
      const fact = TOOLS.find((t) => t.id === r.id);
      if (fact?.trainsOnData === 'yes') {
        blocks.push({
          kind: 'p',
          text: `**${r.name}:** the supplier’s own terms say it trains its AI on what users put in. It must not be used for anything about a person we support. (Checked against the supplier’s published terms on ${formatDate(new Date(fact.checked))}.)`,
        });
      }
    }
  } else {
    blocks.push({
      kind: 'p',
      text: `No AI tools are approved yet. Until a tool is added to this list through section 12, AI tools must not be used for work at ${org}${rule === 'general-only' ? ', apart from personal accounts used as described below' : ''}.`,
    });
  }

  if (!allowsAi(a)) {
    // Covered above.
  } else if (rule === 'work-only') {
    blocks.push({
      kind: 'p',
      text: 'Personal accounts are never approved for work, including paid personal plans. A personal plan, free or paid, comes without a data processing agreement, so there is no contract governing what the supplier does with anything entered.',
    });
  } else if (rule === 'general-only') {
    blocks.push({
      kind: 'p',
      text: 'Staff may use a personal AI account only for tasks that involve no information about any person, such as drafting a job advert or a funding bid from general facts. **Nothing about a person we support, a colleague or anyone else may ever go into a personal account.** Treat personal accounts as public.',
    });
  } else {
    blocks.push({
      kind: 'p',
      text: gap('whether personal AI accounts may be used for tasks with no personal information'),
    });
  }

  const embedded = embeddedAi(a);
  if (embedded.length) {
    const labels = getSlot('embedded')?.options ?? [];
    blocks.push({ kind: 'heading', text: 'AI built into systems we already use' });
    blocks.push({
      kind: 'table',
      head: ['System', 'What this means'],
      rows: embedded.map((e) => [
        e === 'other'
          ? text(a, 'embeddedOther') || gap('name of the other system')
          : (labels.find((o) => o.id === e)?.label.replace(/, e\.g\..*$/, '') ?? e),
        'Covered by this policy: a person checks what it produces, and it is included in our DPIA.',
      ]),
    });
    blocks.push({
      kind: 'p',
      text: 'When a supplier adds a new AI feature to one of our systems, it is treated as a new tool under section 12 before anyone relies on it.',
    });
  }

  if (rows.some((r) => r.plan === 'business' || r.plan === 'mixed')) {
    blocks.push({
      kind: 'p',
      text: 'Before you start, check which account you are signed in to. Personal and work accounts look almost identical on screen.',
    });
  }
  blocks.push({
    kind: 'p',
    text: `${Who(a, 'owner', 'policy owner')} keeps this list up to date. Tools are only added through section 12.`,
  });
  return { id: 'tools', title: 'Approved tools and accounts', blocks };
}

/** Can a task involving information about people start now, in some tool? */
function readyForPeople(a: Answers): boolean {
  if (embeddedAi(a).length) return true;
  return usableTools(a).length > 0 && (a.dpa === 'yes' || a.dpa === 'some') && a.dpia === 'done';
}

function usesSection(a: Answers, snippets: Snippets): Section {
  const chosen = list(a, 'tasks');
  const example = (id: string) => snippets.examples?.[id] ?? DEFAULT_EXAMPLES[id] ?? '';
  const line = (id: string) => {
    const use = USES.find((u) => u.id === id);
    return use ? `**${use.title}.** ${example(id)}` : '';
  };
  const general = USES.filter((u) => u.readiness === 'good' && chosen.includes(u.id)).map((u) => line(u.id));
  const withPeople = USES.filter((u) => u.readiness === 'care' && chosen.includes(u.id)).map((u) =>
    line(u.id),
  );
  const other = text(a, TASKS_OTHER) || text(a, 'tasksOther');
  const blocks: Block[] = [];

  if (!allowsAi(a)) {
    blocks.push({
      kind: 'p',
      text: 'AI tools are not used for work at present. Apart from AI built into the systems in section 4, nobody uses AI for any work task until this policy is updated.',
    });
    return { id: 'uses', title: 'What AI may be used for', blocks };
  }
  if (!general.length && !withPeople.length && !other) {
    blocks.push({ kind: 'p', text: gap('which tasks AI may be used for') });
  } else {
    blocks.push({
      kind: 'p',
      text: 'AI may be used to help with the tasks below. A person checks every result (section 8).',
    });
    if (general.length) {
      blocks.push({ kind: 'heading', text: 'Tasks that involve no information about people' });
      blocks.push({ kind: 'bullets', items: general });
    }
    if (withPeople.length) {
      blocks.push({ kind: 'heading', text: 'Tasks that involve information about people' });
      blocks.push({
        kind: 'p',
        text: readyForPeople(a)
          ? 'Only in a tool approved for information about people in section 4, and only with the safeguards in section 7.'
          : '**None of these can start yet.** No tool in section 4 is approved for information about people. They start only once a tool is, with the safeguards in section 7 in place.',
      });
      blocks.push({ kind: 'bullets', items: withPeople });
    }
    if (other) {
      blocks.push({
        kind: 'p',
        text: `Also agreed, subject to the same rules: ${other}. If these involve information about people, section 7 applies.`,
      });
    }
  }
  blocks.push({
    kind: 'p',
    text: `Any other use needs agreement from ${who(a, 'approver', 'who approves new tools and uses')} first.`,
  });
  return { id: 'uses', title: 'What AI may be used for', blocks };
}

function neverSection(a: Answers): Section {
  const decide = [
    'anyone’s care or support',
    'anyone’s risk level',
    'whether someone is eligible for a service, or how urgently they are seen',
    'whether to raise a safeguarding concern',
  ];
  if (a.capacity === 'yes' || isUnsure(a.capacity)) {
    decide.push('whether someone has capacity to make a decision, or what is in their best interests');
  }
  const never = [
    'as the author of a care plan, a safeguarding record, an incident report, or anything we send to our regulator, such as a registration application. AI may draft parts of these, but a person writes the final version, checks every fact against our own records and is responsible for it',
    'to record or transcribe anyone without telling them',
    'in a tool or account that section 4 does not approve for that task',
  ];
  // Their own red lines, as clauses the model has fitted to this list. Without
  // that, their words are quoted as they typed them rather than forced into it.
  const tidied = list(a, RED_LINES);
  never.push(...tidied);
  const own = tidied.length ? '' : text(a, 'redLines');
  return {
    id: 'never',
    title: 'What AI must never be used for',
    blocks: [
      { kind: 'p', text: 'AI must never be used to decide:' },
      { kind: 'bullets', items: decide },
      {
        kind: 'p',
        text: 'Where AI suggests something about a person, the person who decides must genuinely consider it, and can reject it. Clicking to accept whatever the tool suggests is not a human decision. UK GDPR restricts significant decisions made solely by automated means, especially those based on health information.',
      },
      { kind: 'p', text: 'AI must also never be used:' },
      { kind: 'bullets', items: never },
      ...(own ? [{ kind: 'p' as const, text: `We have also agreed: “${own.replace(/[.\s]+$/, '')}.”` }] : []),
      { kind: 'p', text: '**AI drafts and organises. People decide.**' },
    ],
  };
}

function dataSection(a: Answers): Section {
  const blocks: Block[] = [];
  const personal = usesPersonalData(a);
  blocks.push({
    kind: 'p',
    text: personal
      ? 'Never enter any of the following into a tool or account that section 4 does not approve for information about people:'
      : 'Never enter any of the following into any AI tool:',
  });
  blocks.push({
    kind: 'bullets',
    items: [
      'names, addresses, dates of birth, NHS numbers or photographs of people we support',
      'anything that identifies someone in combination, such as a rare condition in a small village, or “the gentleman on the Tuesday round with the new hoist”',
      'care records, incident records or safeguarding information',
      'personal or HR information about staff or volunteers',
      'confidential business information',
    ],
  });
  blocks.push({
    kind: 'p',
    text: '**Passwords, security codes and bank details never go into any AI tool**, approved or not.',
  });
  if (!personal) {
    blocks.push({
      kind: 'p',
      text: '**At present, no AI tool is approved for information about people.** Using AI with personal information would need a new decision through section 12, including a data processing agreement and a data protection impact assessment.',
    });
  } else {
    const dpa: Record<string, string> = {
      yes: 'in place',
      some: '**in place for some suppliers only**; a tool may only be used once its own agreement is confirmed',
      no: '**not yet in place**',
    };
    const dpia: Record<string, string> = {
      done: 'completed',
      'in-progress': '**started, not yet complete**',
      no: '**not yet done**',
    };
    blocks.push({
      kind: 'p',
      text: 'Information about people may only go into a tool approved for it in section 4, and only when all of these are in place:',
    });
    blocks.push({
      kind: 'bullets',
      items: [
        `a data processing agreement with the supplier (currently: ${dpa[String(a.dpa)] ?? gap('whether we have one')})`,
        `a data protection impact assessment (DPIA), completed before the use starts (currently: ${dpia[String(a.dpia)] ?? gap('DPIA status')})`,
        'the people concerned have been told (section 9)',
        'only the information the task needs is entered. Where the task allows it, remove names and details, or use made-up ones.',
      ],
    });
    blocks.push({
      kind: 'p',
      text: 'Health information is special category data under UK GDPR. Our DPIA records the lawful basis for each use, where the supplier holds the data, and how long it keeps it. If data is held outside the UK, our privacy notice says so.',
    });
    blocks.push({
      kind: 'p',
      text: 'If a supplier processes data outside the UK, we confirm the legal safeguard before using the tool and record it in the DPIA. For a supplier in the United States, that means checking it is certified under the UK Extension to the Data Privacy Framework, or that another mechanism, such as the International Data Transfer Agreement, is in place.',
    });
  }
  blocks.push({
    kind: 'p',
    text: `If you would not put it in an email to a stranger, do not put it into an AI tool. Ask ${who(a, 'dpLead', 'data protection lead')} if you are not sure.`,
  });
  return { id: 'data', title: 'Personal and sensitive information', blocks };
}

function checkingSection(a: Answers): Section {
  const blocks: Block[] = [
    {
      kind: 'p',
      text: 'Every AI-produced draft is read and corrected by a person before it is used, sent or saved. The person who used the tool is responsible for what they use.',
    },
    {
      kind: 'p',
      text: 'Check the facts, not just the writing. AI writes fluently and can be confidently wrong. Look especially at:',
    },
    {
      kind: 'bullets',
      items: [
        'names, dates and times',
        'medicines and doses',
        'anything summarised: has a detail been dropped? The odd detail is often the one that matters',
        'strong language that has been softened. If someone shouted, threw something or refused, the record says so, in their words where possible',
        'whether it works as well for everyone. Check output about people with dementia, a learning disability, a sensory impairment or English as an additional language especially carefully',
      ],
    },
    {
      kind: 'p',
      text: `**Spot-checks.** ${Who(a, 'checker', 'who spot-checks AI output')} checks a sample of AI-produced work ${checkRate(a)}, and records what they found and any corrections. Checking continues for as long as we use AI, not only during a trial.`,
    },
  ];
  if (inEngland(a)) {
    blocks.push({
      kind: 'p',
      text: 'CQC expects AI outputs to be “continuously monitored and evaluated”, and reads this into Regulation 17 (good governance). These checks are how we meet it.',
    });
  }
  return { id: 'checking', title: 'Checking what AI produces', blocks };
}

function peopleSection(a: Answers): Section {
  if (!usesPersonalData(a)) {
    return {
      id: 'people',
      title: 'Telling the people we support',
      blocks: [
        {
          kind: 'p',
          text: 'AI is not currently used with information about the people we support. If that changes, we will tell them, and their families or representatives where appropriate, before we start, and update our privacy notice.',
        },
      ],
    };
  }
  const how: Record<string, string> = {
    letter: 'a short letter',
    review: 'a conversation at their next review',
    welcome: 'our welcome pack for new people',
    privacy: 'our privacy notice',
  };
  const methods = list(a, 'tellPeople').map((m) => how[m] ?? m);
  const blocks: Block[] = [
    {
      kind: 'p',
      text: 'We tell the people we support, and their families or representatives where appropriate, that we use AI and what for, **before** we start. We say, in plain words:',
    },
    {
      kind: 'bullets',
      items: [
        'what the tool does, for example “it types up what the care worker says”',
        'that a person checks everything before it is saved',
        'that it does not make any decisions about their care',
      ],
    },
    {
      kind: 'p',
      text: methods.length ? `We tell people through ${joinList(methods)}.` : gap('how we tell people'),
    },
  ];
  if (!list(a, 'tellPeople').includes('privacy')) {
    blocks.push({
      kind: 'p',
      text: 'We also update our privacy notice, because the AI supplier becomes a recipient of personal data.',
    });
  }
  const optOut: Record<string, string> = {
    alternative:
      'Anyone who does not want AI involved in their records can say so, and we will do that work without AI for them. Nobody receives a worse service because of it.',
    case: 'Anyone who does not want AI involved in their records can say so. We will listen, talk through the options, and decide case by case. We record the objection and what we decided.',
    cannot:
      'Anyone who does not want AI involved in their records can say so. We will listen, explain how AI is used and checked, and record their objection and why we decided as we did.',
  };
  blocks.push({
    kind: 'p',
    text: optOut[String(a.optOut)] ?? gap('what we do if someone does not want AI involved'),
  });
  if (usesMonitoring(a)) {
    blocks.push({ kind: 'heading', text: 'Monitoring and assessment technology' });
    blocks.push({
      kind: 'p',
      text: `Monitoring or assessment technology is only used for a person when they have agreed and that is recorded or, where they lack capacity for that decision, after a capacity assessment and a best interests decision under ${capacityLaw(a)}, recorded in their care plan. We consider whether a less restrictive option would work as well, and review the decision when their needs change.`,
    });
  }
  if (a.capacity === 'yes' || isUnsure(a.capacity)) {
    blocks.push({ kind: 'heading', text: 'Capacity' });
    blocks.push({
      kind: 'p',
      text: `Capacity is specific to each decision, and we start from the presumption that a person has capacity. We take all practicable steps to help people understand, for example with an easy-read or shorter explanation delivered by someone they know. Where a person cannot decide even with support, any decision is made in their best interests under ${capacityLaw(a)}, and recorded. We tell people how we use AI whatever their capacity; that duty does not depend on it.`,
    });
  }
  return { id: 'people', title: 'Telling the people we support', blocks };
}

function safeguardingSection(): Section {
  return {
    id: 'safeguarding',
    title: 'Safeguarding',
    blocks: [
      {
        kind: 'bullets',
        items: [
          'AI is never used to decide whether something is a safeguarding concern. That decision stays with a person, following our safeguarding policy.',
          'Safeguarding information never goes into a tool that is not approved for information about people.',
          'When AI helps write up a concern that a person has already decided to raise, the original words are kept. Direct speech and strong language are not softened.',
          'If safeguarding information goes into the wrong tool, it is treated as a data breach (section 11).',
        ],
      },
    ],
  };
}

function incidentsSection(a: Answers): Section {
  const reportTo = who(a, 'reportTo', 'who staff report AI problems to');
  const how = reportHow(a);
  const lead = Who(a, 'dpLead', 'data protection lead');
  const blocks: Block[] = [
    { kind: 'p', text: `Tell ${reportTo}${how ? ` ${how}` : ''} if:` },
    {
      kind: 'bullets',
      items: [
        'an AI tool produced something wrong that was used, or nearly used',
        'information about a person went into a tool or account not approved for it',
        'you are not sure whether something is allowed',
      ],
    },
    { kind: 'p', text: '**Reporting a mistake will not get you into trouble. Not reporting one might.**' },
    {
      kind: 'p',
      text: `If information about a person has gone into the wrong tool or account: write down what was entered, when, and into which tool and account; delete it where you can, knowing that deleting a chat may not remove every copy; and tell ${reportTo} straight away.`,
    },
    {
      kind: 'p',
      text:
        a.breachProcedure === 'yes'
          ? `${lead} treats it as a potential personal data breach and follows our data breach procedure, including deciding whether it must be reported to the Information Commissioner’s Office (ICO). A reportable breach must be reported within 72 hours of our becoming aware of it.`
          : `${lead} treats it as a potential personal data breach and decides whether it must be reported to the Information Commissioner’s Office (ICO). A reportable breach must be reported within 72 hours of our becoming aware of it. ${gap('our written data breach procedure')}`,
    },
    {
      kind: 'p',
      text: 'We look at what happened, fix the cause and share what we learned with the team. The risk to the person comes first, before the risk to the organisation.',
    },
  ];
  if (inEngland(a)) {
    blocks.push({
      kind: 'p',
      text: 'If an AI error contributes to harm to someone we support, our duty of candour applies as it would to any other incident.',
    });
  }
  return { id: 'incidents', title: 'When something goes wrong', blocks };
}

function newToolsSection(a: Answers): Section {
  const blocks: Block[] = [
    {
      kind: 'p',
      text: `No new AI tool, and no new use of an existing one, starts until ${who(a, 'approver', 'who approves new tools')} has approved it. This includes AI features added to software we already use, such as email or our care management system: a new AI feature counts as a new tool.`,
    },
    { kind: 'p', text: 'Before any tool is used with information about a person, we:' },
    {
      kind: 'bullets',
      items: [
        'ask the supplier our standard questions, including where data is held, whether it is used to train their AI, whether anyone at the supplier can read it, and what the tool gets wrong, and keep the answers',
        'get a data processing agreement in writing',
        'complete a data protection impact assessment before the use starts',
        'tell the people affected (section 9)',
        'add the tool and the account to section 4',
      ],
    },
  ];
  if (inEngland(a)) {
    blocks.push({
      kind: 'p',
      text: 'No AI tool is “CQC approved”. CQC does not assess or approve specific technologies, so a supplier claiming otherwise is a reason to slow down.',
    });
  }
  blocks.push({
    kind: 'p',
    text: 'Tools that monitor, predict or assess health, for example predicting falls or scoring pain, may be regulated as medical devices. Before using one, we ask the supplier whether it is, and if so for its UKCA or CE marking and its registration with the Medicines and Healthcare products Regulatory Agency (MHRA).',
  });
  if (a.nhs === 'yes') {
    blocks.push({
      kind: 'p',
      text: 'Every AI tool that handles personal data is added to our information asset register and data flow map, and we keep our Data Security and Protection Toolkit (DSPT) return consistent with this policy.',
    });
  }
  return { id: 'new-tools', title: 'Before any new tool', blocks };
}

function staffSection(a: Answers): Section {
  const training: Record<string, string> = {
    planned:
      'Everyone this policy applies to is trained on it, and on the approved tools, before they use AI for work.',
    induction:
      'This policy and the approved tools are part of induction for new starters. Existing staff are briefed on it when it is approved.',
  };
  const blocks: Block[] = [
    {
      kind: 'p',
      text:
        training[String(a.training)] ??
        `Everyone this policy applies to reads it before using AI for work. ${gap('how staff will be trained')}`,
    },
  ];
  if (usesPersonalData(a)) {
    blocks.push({
      kind: 'p',
      text: 'Anyone who uses AI in someone’s care should be able to explain, in a sentence, how it is involved and that a person checks everything. Staff cannot properly obtain consent for care they cannot explain.',
    });
  }
  if (a.ownDevices === 'yes' || a.ownDevices === 'some') {
    blocks.push({
      kind: 'p',
      text: 'Some staff use their own phones for work. On a personal phone, only the approved work accounts in section 4 may be used for work, and personal AI apps are never used for anything about a person. AI features in keyboards, voice assistants and messaging apps count as AI tools.',
    });
  } else if (a.ownDevices === 'no') {
    blocks.push({
      kind: 'p',
      text: 'AI apps are only installed on work phones if they are approved in section 4.',
    });
  }
  blocks.push({
    kind: 'p',
    text: `Staff are asked for their views before a new AI tool is introduced. Anyone can raise a concern about how AI is used with ${who(a, 'owner', 'policy owner')} or through our usual speaking-up route, and will not be treated worse for doing so.`,
  });
  if (list(a, 'workforce').includes('agency')) {
    blocks.push({
      kind: 'p',
      text: 'Agency staff are shown the staff summary of this policy before their first shift.',
    });
  }
  return { id: 'staff', title: 'Staff, training and devices', blocks };
}

function recordsSection(a: Answers): Section {
  const items = [
    'We keep a simple AI log: the approved tools and accounts, spot-check results, corrections, incidents and near misses.',
    `${Who(a, 'owner', 'policy owner')} reviews the log at least every three months and reports a summary to ${signoffBy(a)} at least once a year.`,
    'We re-check each supplier’s terms at every review, because suppliers change them without notice.',
  ];
  if (usesPersonalData(a)) {
    items.splice(
      2,
      0,
      'We keep our DPIAs, data processing agreements and suppliers’ answers to our questions with this policy.',
    );
  }
  return { id: 'records', title: 'Records and monitoring', blocks: [{ kind: 'bullets', items }] };
}

function purposeSection(a: Answers, snippets: Snippets): Section {
  const org = orgName(a);
  const purpose =
    snippets.purpose ??
    `This policy sets out how ${org} uses artificial intelligence (AI) tools safely, lawfully and in the interests of the people we support. It says which tools are approved, what they may and may not be used for, who checks the results, and what to do when something goes wrong.`;
  return {
    id: 'purpose',
    title: 'Purpose and scope',
    blocks: [
      { kind: 'p', text: purpose },
      {
        kind: 'p',
        text: `It applies to ${workforce(a)} whenever they use an AI tool for work, on any device, including their own phone.`,
      },
      {
        kind: 'p',
        text: 'By “AI tool” we mean any software that writes, summarises, transcribes, translates or suggests content. That includes assistants such as ChatGPT or Copilot, and AI features built into software we already use.',
      },
      {
        kind: 'p',
        text: 'This policy works alongside our data protection, confidentiality, consent and mental capacity, safeguarding and record-keeping policies. It does not replace them, and where they touch on AI they should agree with it.',
      },
    ],
  };
}

function principlesSection(a: Answers): Section {
  const personal = usesPersonalData(a);
  const items = [
    ...(allowsAi(a)
      ? []
      : [
          '**No AI for work, for now.** Staff do not use AI tools for work. AI built into our existing systems is still covered by every rule below.',
        ]),
    '**AI supports, people decide.** AI may draft, summarise and organise. Decisions about people’s care and support are made by people.',
    '**A person checks everything.** Nothing AI produces is used, sent or saved until a person has read and corrected it.',
    '**Approved tools only.** Only the tools and accounts in section 4 may be used for work.',
    personal
      ? '**Personal information is protected.** Information about people only goes into a tool approved for it, with the safeguards in section 7.'
      : '**Personal information stays out.** Nothing about the people we support or staff goes into an AI tool.',
  ];
  if (personal)
    items.push('**We are open about it.** We tell the people we support how we use AI, before we start.');
  items.push('**Mistakes are reported, not hidden.** Reporting a mistake will not get anyone into trouble.');
  const blocks: Block[] = [{ kind: 'bullets', items }];
  blocks.push({
    kind: 'p',
    text: `Our regulator${list(a, 'nations').length > 1 ? 's are' : ' is'} ${regulators(a)}. ${
      inEngland(a)
        ? 'These principles follow CQC’s principles for good use of AI in health and social care.'
        : 'We are expected to meet the same standards of safe, well-governed care whatever tools we use.'
    }`,
  });
  return { id: 'principles', title: 'Principles', blocks };
}

function rolesSection(a: Answers): Section {
  return {
    id: 'roles',
    title: 'Roles and responsibilities',
    blocks: [
      {
        kind: 'table',
        head: ['Role', 'Who', 'Responsibilities'],
        rows: [
          [
            'Policy owner',
            whoCell(a, 'owner', 'policy owner'),
            'Keeps this policy and the approved tools list up to date, and arranges review.',
          ],
          [
            'Approves new tools',
            whoCell(a, 'approver', 'who approves new tools'),
            'Decides whether a new AI tool or use may start, after the checks in section 12.',
          ],
          [
            'Data protection lead',
            whoCell(a, 'dpLead', 'data protection lead'),
            'Advises on DPIAs and data processing agreements, and leads on any data breach.',
          ],
          [
            'Spot-checks AI output',
            whoCell(a, 'checker', 'who spot-checks AI output'),
            `Checks a sample of AI-produced work ${checkRate(a)} and records what they find.`,
          ],
          [
            'Receives reports',
            whoCell(a, 'reportTo', 'who staff report problems to'),
            'Receives reports of AI mistakes and misuse, and makes sure they are followed up.',
          ],
          [
            'Signs off the policy',
            capitalise(signoffBy(a)),
            'Approves this policy and receives a summary of AI use and incidents at least once a year.',
          ],
          [
            'Everyone using AI',
            capitalise(workforce(a)),
            'Uses approved tools only, checks their own AI drafts, and reports problems.',
          ],
        ],
      },
    ],
  };
}

function reviewSection(a: Answers, today: Date): Section {
  return {
    id: 'review',
    title: 'Review and sign-off',
    blocks: [
      {
        kind: 'p',
        text: `${Who(a, 'owner', 'policy owner')} owns this policy. It is reviewed by ${reviewDate(a, today)}, and sooner if a supplier changes its terms, we add a tool, or something goes wrong.`,
      },
      {
        kind: 'table',
        head: ['Approved by', 'Name', 'Signature', 'Date'],
        rows: [[capitalise(signoffBy(a)), '', '', '']],
      },
    ],
  };
}

function staffSummary(a: Answers): { title: string; blocks: Block[] } {
  const org = orgName(a);
  const personal = usesPersonalData(a);
  const rows = allowsAi(a) ? usableTools(a) : [];
  const toolLine = !allowsAi(a)
    ? '**Do not use AI tools for work**, including free and personal accounts. Ask first if you are unsure whether something counts.'
    : rows.length
      ? `**Only use these tools, signed in to the work account:** ${joinList(rows.map((r) => r.name))}.`
      : `**No AI tools are approved for work yet.** Ask ${who(a, 'approver', 'who approves new tools')} before using any.`;
  const items = [toolLine];
  if (a.accountRule === 'general-only') {
    items.push(
      'A personal AI account is only allowed for tasks with no information about anyone, like a job advert. Treat it as public.',
    );
  } else if (a.accountRule === 'work-only') {
    items.push('Never use a personal AI account for work, even a paid one.');
  }
  items.push(
    `**${personal ? 'Never put these into a tool or account not approved for them' : 'Never put these into AI'}:** names, addresses, dates of birth, NHS numbers or photos of anyone we support; anything that could identify someone; care, incident or safeguarding records; anything about colleagues.`,
    '**AI drafts. You decide.** Never use AI to decide someone’s care, risk, eligibility, or whether to raise a safeguarding concern.',
    '**Check everything before you use, send or save it:** names, times, medicines, and anything that sounds smoother than what really happened.',
  );
  if (personal) {
    items.push(
      '**Be open.** Be ready to explain, in a sentence, how AI is used and that a person checks everything.',
    );
  }
  const how = reportHow(a);
  items.push(
    `**If something goes wrong, tell ${who(a, 'reportTo', 'who to tell')}${how ? ` ${how}` : ''}.** You will not get into trouble for reporting a mistake.`,
    `**Not sure? Ask ${who(a, 'owner', 'policy owner')} first.**`,
    'If you would not put it in an email to a stranger, do not put it into AI.',
  );
  return { title: `Using AI at ${org}: the short version`, blocks: [{ kind: 'bullets', items }] };
}

function countGaps(doc: Omit<PolicyDoc, 'gaps'>): number {
  const texts: string[] = [];
  const walk = (blocks: Block[]) => {
    for (const b of blocks) {
      if (b.kind === 'p' || b.kind === 'heading') texts.push(b.text);
      if (b.kind === 'bullets') texts.push(...b.items);
      if (b.kind === 'table') texts.push(...b.rows.flat());
    }
  };
  doc.sections.forEach((s) => walk(s.blocks));
  walk(doc.summary.blocks);
  texts.push(...doc.meta.map(([, v]) => v));
  return new Set(texts.flatMap((t) => t.match(GAP) ?? [])).size;
}

export function assemblePolicy(answers: Answers, snippets: Snippets = {}, today = new Date()): PolicyDoc {
  const a = withWording(prune(answers), snippets.wording);
  const sections: Section[] = [
    purposeSection(a, snippets),
    principlesSection(a),
    rolesSection(a),
    toolsSection(a),
    usesSection(a, snippets),
    neverSection(a),
    dataSection(a),
    checkingSection(a),
    peopleSection(a),
    safeguardingSection(),
    incidentsSection(a),
    newToolsSection(a),
    staffSection(a),
    recordsSection(a),
    reviewSection(a, today),
  ];
  const doc = {
    orgName: orgName(a),
    meta: [
      ['Version', '1.0'],
      ['Date', formatDate(today)],
      ['Review by', reviewDate(a, today)],
      ['Owner', whoCell(a, 'owner', 'policy owner')],
    ] as [string, string][],
    sections,
    summary: staffSummary(a),
    actions: buildActions(a, today),
  };
  return { ...doc, gaps: countGaps(doc) };
}
