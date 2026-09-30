// The action plan: what has to happen before the policy is true. Each rule
// reads the answers and, where there is a gap, says what to do and why, with a
// link to the hub page that explains it. Deterministic, so the same answers
// always give the same plan.

import { ANONYMISER_URL, TOOLS } from '../knowledge.generated.js';
import {
  allowsAi,
  type Answers,
  embeddedAi,
  getSlot,
  isNobody,
  isUnsure,
  list,
  text,
  usesMonitoring,
  usesPersonalData,
} from '../interview.js';
import type { Action, Resource } from './types.js';
import {
  capitalise,
  chosenTools,
  formatDate,
  hubLink,
  inEngland,
  isPersonalPlan,
  joinList,
  reviewDate,
  signoffBy,
  who,
} from './words.js';

const lowerFirst = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Role questions that, left unanswered, leave a hole in the policy. */
const ROLE_SLOTS = [
  'owner',
  'approver',
  'dpLead',
  'checker',
  'reportTo',
  'checkRate',
  'signoffBy',
  'reviewMonths',
];

export function buildActions(a: Answers, today: Date): Action[] {
  const actions: Action[] = [];
  const add = (action: Action) => actions.push(action);
  const personal = usesPersonalData(a);
  const tools = allowsAi(a) ? chosenTools(a) : [];
  const lead = who(a, 'dpLead', 'your data protection lead');

  if (isUnsure(a.personalDataEntered)) {
    add({
      id: 'check-entered',
      priority: 'now',
      title: 'Find out whether information about people has gone into AI',
      why: `Ask staff, without blame, whether anything about a person you support has been typed into an AI tool. If it went into a personal account or a tool without a data processing agreement, ${lead} treats it as a potential data breach.`,
      link: hubLink('/guides/safeguarding-and-ai'),
    });
  }

  if (a.personalDataEntered === 'yes') {
    add({
      id: 'already-entered',
      priority: 'now',
      title: 'Deal with information about people that has already gone into AI',
      why: `Where it went into a personal account, or a tool without a data processing agreement, treat it as a potential data breach. Record what was entered, when and where, and let ${lead} decide whether it must be reported to the ICO; a reportable breach has to be reported within 72 hours of becoming aware of it. Handle it without blame, or the next one will not be reported.`,
      link: hubLink('/guides/safeguarding-and-ai'),
    });
  }

  if (isUnsure(a.aiInUse)) {
    add({
      id: 'find-out',
      priority: 'now',
      title: 'Find out what AI is already being used',
      why: 'Ask staff openly which tools they use for work and on which accounts, and make it clear nobody is in trouble. You cannot approve or stop what you do not know about.',
      link: hubLink('/guides/free-vs-paid-ai-tools'),
    });
  }

  if (a.personalAccounts === 'yes' || isUnsure(a.personalAccounts)) {
    add({
      id: 'personal-accounts',
      priority: 'now',
      title:
        a.accountRule === 'general-only'
          ? 'Tell staff the rules for personal AI accounts'
          : 'Move work off personal AI accounts',
      why:
        a.accountRule === 'general-only'
          ? 'Personal accounts, free or paid, have no data processing agreement. Under your policy they may only be used for tasks with no information about anyone. Tell staff this in plain words this week, and show them how to check which account they are in.'
          : 'Personal accounts, free or paid, have no data processing agreement, and your policy does not allow them for work. Tell staff this in plain words this week, and give them the approved alternative.',
      link: hubLink('/guides/free-vs-paid-ai-tools'),
    });
  }

  const personalPlanTools = tools.filter((t) => isPersonalPlan(t.plan));
  if (personalPlanTools.length && (personal || a.accountRule !== 'general-only')) {
    const names = joinList(personalPlanTools.map((t) => t.name));
    const them = personalPlanTools.length > 1 ? 'them' : 'it';
    add({
      id: 'business-plans',
      priority: 'now',
      title:
        a.accountRule === 'general-only'
          ? `Keep ${names} to general tasks, or move ${them} to a business plan`
          : `Move ${names} to a business plan, or stop using ${them} for work`,
      why: 'Only business plans come with a data processing agreement. Until then, nothing about any person goes into these tools.',
      link: hubLink('/guides/free-vs-paid-ai-tools'),
    });
  }

  const undecided = tools.filter((t) => t.agreed !== 'yes' && !isPersonalPlan(t.plan));
  if (undecided.length) {
    const names = joinList(undecided.map((t) => t.name));
    const inUse = a.aiInUse === 'approved' || a.aiInUse === 'informal';
    add({
      id: 'decide-tools',
      priority: inUse ? 'now' : 'soon',
      title: `Decide whether to approve ${names}`,
      why: `The policy lists ${undecided.length > 1 ? 'them' : 'it'} as not approved until there is a decision from ${who(a, 'approver', 'whoever approves new tools')}.${inUse ? ' If anyone already uses it for work, tell them to stop until then.' : ''} Go through section 12 first: the supplier questions, a data processing agreement and, before any information about people goes in, a DPIA. Then update section 4.`,
      link: hubLink('/templates/supplier-questions'),
    });
  }

  const mixed = tools.filter((t) => t.plan === 'mixed' && t.agreed === 'yes');
  if (mixed.length) {
    add({
      id: 'mixed-accounts',
      priority: 'soon',
      title: `Get everyone using ${joinList(mixed.map((t) => t.name))} onto the work account`,
      why: 'When some people use personal accounts and some use the work one, nobody can tell which is which on screen. Make checking the account part of the routine.',
      link: hubLink('/guides/free-vs-paid-ai-tools'),
    });
  }

  const unknownPlan = tools.filter((t) => t.plan === 'unsure');
  if (unknownPlan.length) {
    add({
      id: 'confirm-plans',
      priority: 'now',
      title: `Confirm which accounts are used for ${joinList(unknownPlan.map((t) => t.name))}`,
      why: 'The policy marks these as not approved until you know the plan. The plan decides whether there is a data processing agreement, not the tool name.',
      link: hubLink('/guides/free-vs-paid-ai-tools'),
    });
  }

  for (const t of tools) {
    const fact = TOOLS.find((x) => x.id === t.id);
    if (fact?.trainsOnData === 'yes') {
      add({
        id: `trains-${t.id}`,
        priority: 'now',
        title: `Review your use of ${t.name}`,
        why: `${fact.watchOut[0] ?? `${t.name}'s terms say it trains on what users put in.`} (Checked ${formatDate(new Date(fact.checked))}.)`,
        link: hubLink(`/tools/${t.id}`) ?? hubLink('/guides/free-vs-paid-ai-tools'),
      });
    }
  }

  if (personal && tools.length && a.dpa !== 'yes') {
    // Business plans of some tools come with an agreement in the supplier's
    // business terms: the job there is finding and filing it, not asking.
    const included = tools.filter((t) => {
      const fact = TOOLS.find((x) => x.id === t.id);
      return (
        (t.plan === 'business' || t.plan === 'mixed') && (fact?.dpa === 'yes' || fact?.dpa === 'depends')
      );
    });
    const names = joinList(included.map((t) => t.name));
    add({
      id: 'dpa',
      priority: 'now',
      title: included.length
        ? 'Confirm and file a data processing agreement for each tool'
        : 'Get a data processing agreement from each supplier',
      why: `Without one there is no contract governing what the supplier does with personal information.${
        included.length
          ? ` For business plans of ${names}, the supplier’s published terms say one is included: find it, check it covers the account you use, and keep a copy.`
          : ''
      } For anything else, ask the supplier for it in writing before anything about a person goes into the tool. Keep them with your DPIA.`,
      link: hubLink('/templates/supplier-questions'),
    });
  }

  if (personal) {
    for (const t of tools) {
      const fact = TOOLS.find((x) => x.id === t.id);
      if (fact && fact.dpa === 'unknown' && !isPersonalPlan(t.plan)) {
        add({
          id: `dpa-${t.id}`,
          priority: 'soon',
          title: `Ask ${fact.maker} for the ${t.name} data processing agreement`,
          why: `We could not confirm from ${fact.maker}’s published terms whether a data processing agreement is offered. Ask for a copy, and use the supplier questions sheet for the rest.`,
          link: hubLink('/templates/supplier-questions'),
        });
      }
    }
  }

  if (embeddedAi(a).length) {
    add({
      id: 'embedded',
      priority: 'soon',
      title: 'Find out exactly what the AI in your existing systems does',
      why: 'Ask each supplier what the AI feature does, what data it uses, where it is processed, and whether it can be switched off. Include it in your DPIA, and ask to be told before new AI features are switched on.',
      link: hubLink('/templates/supplier-questions'),
    });
  }

  if (usesMonitoring(a)) {
    add({
      id: 'medical-device',
      priority: 'soon',
      title: 'Ask whether your monitoring or assessment tool is a medical device',
      why: 'Software that predicts falls, detects deterioration or scores pain may be regulated as a medical device. Ask the supplier, and if it is, for its UKCA or CE marking and MHRA registration.',
    });
  }

  if (usesMonitoring(a) && a.monitoringConsent !== 'mca') {
    add({
      id: 'monitoring-consent',
      priority: a.monitoringConsent === 'consent' ? 'soon' : 'now',
      title: 'Set out consent and capacity steps for monitoring',
      why: 'For each person, record their agreement or, where they lack capacity for that decision, a capacity assessment and a best interests decision, and consider whether something less restrictive would work.',
      link: hubLink('/guides/capacity-consent-and-ai'),
    });
  }

  if (personal && a.dpia !== 'done') {
    add({
      id: 'dpia',
      priority: 'now',
      title: 'Complete a DPIA before AI touches information about people',
      why: `For AI used with information about the people you support, a data protection impact assessment is almost certainly required, and it has to come before the use starts.${inEngland(a) ? ' CQC names it in its principles for AI.' : ''}`,
      link: hubLink('/templates/ai-dpia'),
    });
  }

  if (personal) {
    for (const t of tools) {
      const fact = TOOLS.find((x) => x.id === t.id);
      if (fact && !isPersonalPlan(t.plan) && t.plan !== 'unsure') {
        add({
          id: `hosting-${t.id}`,
          priority: 'later',
          title: `Record where ${t.name} holds your data`,
          why: `From the supplier’s published terms, checked ${formatDate(new Date(fact.checked))}: ${fact.hosting} If data is held outside the UK, that is an international transfer. Record the safeguard in your DPIA (for the US, the supplier’s certification under the UK Extension to the Data Privacy Framework, or an International Data Transfer Agreement), and say so in your privacy notice.`,
          link: hubLink(`/tools/${t.id}`) ?? hubLink('/guides/telling-people-you-support'),
        });
      }
    }
  }

  if (personal && !list(a, 'tellPeople').includes('privacy')) {
    add({
      id: 'privacy-notice',
      priority: 'soon',
      title: 'Update your privacy notice',
      why: 'The AI supplier becomes a recipient of personal data, and the ICO expects people to be told before a new use starts, not afterwards.',
      link: hubLink('/guides/telling-people-you-support'),
    });
  }

  if (personal && (isUnsure(a.tellPeople) || !list(a, 'tellPeople').some((m) => m !== 'privacy'))) {
    add({
      id: 'tell-people',
      priority: 'soon',
      title: 'Decide how you will tell the people you support',
      why: 'A short letter or a conversation at their next review, before AI is used with their information. Say what it does, that a person checks it, and that it decides nothing about their care.',
      link: hubLink('/templates/telling-people-letter'),
    });
  }

  if (personal && (a.capacity === 'yes' || isUnsure(a.capacity))) {
    add({
      id: 'easy-read',
      priority: 'later',
      title: 'Prepare an easy-read explanation of how you use AI',
      why: 'The duty to help people understand comes before any conclusion that they cannot decide. A short, plain version delivered by someone they know is the practical way to meet it.',
      link: hubLink('/guides/capacity-consent-and-ai'),
    });
  }

  if (a.breachProcedure !== 'yes') {
    add({
      id: 'breach-procedure',
      priority: 'soon',
      title: 'Write a short data breach procedure',
      why: `The policy relies on one. It needs to say who decides whether a breach is reportable to the ICO, how that decision is recorded, and how the 72-hour deadline is met. ${capitalise(lead)} should own it.`,
    });
  }

  if (a.training !== 'planned' && a.training !== 'induction') {
    add({
      id: 'training',
      priority: 'soon',
      title: 'Plan a short training session on this policy',
      why: 'Half an hour on the approved tools, what never goes in, and how to check output does more than the policy alone. The golden rules are a good script.',
      link: hubLink('/guides/golden-rules'),
    });
  }

  const gaps = ROLE_SLOTS.filter(
    (id) => getSlot(id) && (a[id] === undefined || isUnsure(a[id]) || isNobody(text(a, id))),
  );
  if (gaps.length) {
    add({
      id: 'gaps',
      priority: 'now',
      title: 'Fill in the gaps marked [TO DECIDE]',
      why: `Still to decide: ${joinList(gaps.map((id) => lowerFirst(getSlot(id)!.label)))}. A policy with blanks is not yet a policy anyone can follow.`,
      link: hubLink('/guides/writing-an-ai-use-policy'),
    });
  }

  add({
    id: 'sign-off',
    priority: 'soon',
    title: `Take the policy to ${signoffBy(a)} for sign-off`,
    why: 'Expect to be asked what happens if the AI gets something wrong about a person. Section 11 is the answer.',
    link:
      a.signoffBy === 'trustees' || a.signoffBy === 'directors'
        ? hubLink('/templates/board-briefing')
        : undefined,
  });

  add({
    id: 'poster',
    priority: 'later',
    title: 'Print the staff summary and put it where people work',
    why: 'The policy is the record. The summary is what people actually see when they are tired and behind on notes.',
    link: hubLink('/templates/never-paste-this'),
  });

  add({
    id: 'calendar',
    priority: 'later',
    title: `Put the review date in a calendar: ${reviewDate(a, today)}`,
    why: 'Supplier terms change without notice. Re-check each tool’s terms at the review, not just the wording of the policy.',
  });

  const order = { now: 0, soon: 1, later: 2 };
  return actions.sort((x, y) => order[x.priority] - order[y.priority]);
}

/**
 * Free hub pages and tools that help put the policy into practice, beyond the
 * ones the action plan already links to. Only pages that exist are listed.
 */
export function buildResources(a: Answers): Resource[] {
  const out: Resource[] = [];
  const add = (path: string, text: string) => {
    const link = hubLink(path);
    if (link) out.push({ ...link, text });
  };
  if (allowsAi(a)) {
    add('/safe-use/check', 'For staff: five questions about a task, and a plain answer on whether AI fits.');
    add(
      '/guides/spotting-ai-mistakes',
      'For everyone who checks AI output: the mistakes it makes, and how to catch them.',
    );
    add('/templates/prompts', 'Prompts for common care tasks, with the safety notes built in.');
    out.push({
      label: 'Free document anonymiser',
      url: ANONYMISER_URL,
      text: 'Takes names, addresses and other details out of a document. Read the result before using it: context can still identify someone.',
    });
  } else {
    add('/uses', 'If you revisit the decision: what AI can and cannot do in care work, rated honestly.');
  }
  add(
    '/tools',
    'Checked facts on common tools: what each does with your data, and which plans come with a data processing agreement.',
  );
  add('/templates/glossary', 'Plain meanings of DPA, DPIA and the other terms in the policy.');
  return out;
}
