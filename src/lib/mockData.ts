import { Candidate, ScoringRubric, IdealPatterns } from './types';

export const mockRubric: ScoringRubric = {
  mustHaves: [
    { requirement: 'Python proficiency (5+ years)', weight: 25, flexibility: 'Would consider 3+ years with strong ML background' },
    { requirement: 'Machine Learning frameworks (PyTorch/TensorFlow)', weight: 20 },
    { requirement: 'Production ML systems experience', weight: 20 },
    { requirement: 'CS degree or equivalent', weight: 10, flexibility: 'Strong bootcamp + experience acceptable' },
  ],
  niceToHaves: [
    { requirement: 'AWS/GCP cloud experience', weight: 10 },
    { requirement: 'Leadership/mentorship experience', weight: 8 },
    { requirement: 'Published research or patents', weight: 7 },
  ],
  hiddenPreferences: [
    { preference: 'Startup background preferred', source: 'Intake notes' },
    { preference: 'Fast-paced, scrappy mentality', source: 'Intake notes' },
    { preference: 'Strong communication skills', source: 'Intake notes' },
  ],
  seniorityTarget: 'Senior (5-8 years)',
};

export const mockIdealPatterns: IdealPatterns = {
  commonSkills: [
    { skill: 'Python + PyTorch', frequency: 'all' },
    { skill: 'Distributed training', frequency: 'most' },
    { skill: 'Model optimization', frequency: 'most' },
    { skill: 'MLOps/CI/CD', frequency: 'some' },
  ],
  careerPatterns: [
    { pattern: 'FAANG → Series A-C Startup', frequency: 'most' },
    { pattern: 'IC → Tech Lead progression', frequency: 'all' },
    { pattern: 'Research → Applied ML', frequency: 'some' },
  ],
  achievementSignals: [
    { signal: 'Led team of X engineers', examples: ['Led team of 5 ML engineers', 'Managed 3 direct reports'] },
    { signal: 'Shipped product to Y users', examples: ['Deployed to 10M+ users', 'Launched feature used by 50K DAU'] },
    { signal: 'Reduced latency/cost by Z%', examples: ['Cut inference time by 40%', 'Reduced training costs by 60%'] },
  ],
};

export const mockCandidates: Candidate[] = [
  {
    id: '1',
    name: 'Sarah Chen',
    email: 'sarah.chen@email.com',
    currentRole: 'Senior ML Engineer',
    currentCompany: 'Stripe',
    yearsExperience: 7,
    scores: { technical: 9.5, experience: 9, alignment: 9.5, growth: 9 },
    overallScore: 9.3,
    tier: 'top',
    strengths: [
      'Led ML platform team at Series B startup (matches ideal pattern)',
      'Published research on transformer efficiency at NeurIPS',
      'Strong Python/PyTorch with production experience',
    ],
    gaps: [],
    reasoning: 'Exceptional candidate with direct experience in ML infrastructure at scale. Career trajectory matches ideal pattern (FAANG → startup). Leadership experience and research background are standout qualities.',
  },
  {
    id: '2',
    name: 'Marcus Johnson',
    email: 'marcus.j@email.com',
    currentRole: 'ML Tech Lead',
    currentCompany: 'Anthropic',
    yearsExperience: 8,
    scores: { technical: 10, experience: 9.5, alignment: 9, growth: 9.5 },
    overallScore: 9.5,
    tier: 'top',
    strengths: [
      'Current role at frontier AI lab',
      'Extensive experience with LLM training and RLHF',
      'Strong publication record and open source contributions',
    ],
    gaps: ['May be overqualified for role'],
    reasoning: 'Outstanding technical background with direct experience at a leading AI lab. Deep expertise in the exact technical domain. May need to assess compensation expectations and role scope.',
  },
  {
    id: '3',
    name: 'Emily Rodriguez',
    email: 'emily.r@email.com',
    currentRole: 'Senior Software Engineer',
    currentCompany: 'Google',
    yearsExperience: 6,
    scores: { technical: 8.5, experience: 8, alignment: 8.5, growth: 9 },
    overallScore: 8.5,
    tier: 'strong',
    strengths: [
      'Strong distributed systems background',
      'Led team of 4 engineers on ML infrastructure project',
      'FAANG pedigree with startup interest mentioned',
    ],
    gaps: ['ML experience is more infra-focused than model development'],
    reasoning: 'Solid candidate with excellent engineering foundation. ML experience skews toward infrastructure rather than modeling, but strong technical skills and leadership make this worth exploring.',
  },
  {
    id: '4',
    name: 'David Kim',
    email: 'david.kim@email.com',
    currentRole: 'Machine Learning Engineer',
    currentCompany: 'OpenAI',
    yearsExperience: 5,
    scores: { technical: 9, experience: 8, alignment: 8.5, growth: 9 },
    overallScore: 8.6,
    tier: 'strong',
    strengths: [
      'Current role at top AI lab',
      'Hands-on experience with large-scale training',
      'Strong Python and PyTorch skills',
    ],
    gaps: ['Limited leadership experience', 'May prefer research over applied work'],
    reasoning: 'Strong technical candidate from a top AI lab. Excellent hands-on skills but limited leadership experience. Would benefit from discussing career goals.',
  },
  {
    id: '5',
    name: 'Jessica Wang',
    email: 'jwang@email.com',
    currentRole: 'ML Engineer II',
    currentCompany: 'Meta',
    yearsExperience: 4,
    scores: { technical: 8, experience: 7.5, alignment: 8, growth: 8.5 },
    overallScore: 8.0,
    tier: 'strong',
    strengths: [
      'Strong recommendation systems experience',
      'Experience with production ML at scale',
      'Clear growth trajectory',
    ],
    gaps: ['Slightly below experience target', 'No LLM-specific experience'],
    reasoning: 'Promising candidate with solid foundation. Experience is slightly below target but trajectory is strong. Would need to ramp up on LLM-specific work.',
  },
  {
    id: '6',
    name: 'Alex Thompson',
    email: 'alex.t@email.com',
    currentRole: 'Data Scientist',
    currentCompany: 'Uber',
    yearsExperience: 5,
    scores: { technical: 7.5, experience: 7, alignment: 7.5, growth: 8 },
    overallScore: 7.5,
    tier: 'moderate',
    strengths: [
      'Strong statistics and modeling background',
      'Experience with production systems',
    ],
    gaps: [
      'Data Science role vs ML Engineering',
      'Limited deep learning experience',
      'No leadership experience mentioned',
    ],
    reasoning: 'Solid data science background but role has been more analytics-focused than engineering. Would need to assess depth of ML engineering skills in interview.',
  },
  {
    id: '7',
    name: 'Ryan Martinez',
    email: 'ryan.m@email.com',
    currentRole: 'Software Engineer',
    currentCompany: 'Amazon',
    yearsExperience: 6,
    scores: { technical: 7, experience: 7.5, alignment: 7, growth: 7.5 },
    overallScore: 7.3,
    tier: 'moderate',
    strengths: [
      'Strong backend engineering skills',
      'AWS expertise',
      'Experience with high-scale systems',
    ],
    gaps: [
      'ML experience is primarily hobbyist/side projects',
      'No production ML experience',
      'Would need significant ramp-up time',
    ],
    reasoning: 'Strong engineer interested in ML transition. Has the engineering fundamentals but lacks production ML experience. Consider for more junior ML role.',
  },
  {
    id: '8',
    name: 'Lisa Park',
    email: 'lisa.park@email.com',
    currentRole: 'Junior ML Engineer',
    currentCompany: 'Startup (Series A)',
    yearsExperience: 2,
    scores: { technical: 7, experience: 5, alignment: 7, growth: 8 },
    overallScore: 6.8,
    tier: 'below',
    strengths: [
      'Startup mentality',
      'Eager learner with recent ML Masters',
    ],
    gaps: [
      'Significantly below experience requirement',
      'Limited production experience',
      'No leadership experience',
    ],
    reasoning: 'Promising early-career candidate but significantly below seniority target. Better fit for mid-level role.',
  },
  {
    id: '9',
    name: 'Michael Brown',
    email: 'm.brown@email.com',
    currentRole: 'Research Scientist',
    currentCompany: 'University Lab',
    yearsExperience: 8,
    scores: { technical: 8, experience: 6, alignment: 6, growth: 6.5 },
    overallScore: 6.6,
    tier: 'below',
    strengths: [
      'Strong research background',
      'Multiple publications',
      'Deep theoretical knowledge',
    ],
    gaps: [
      'No industry experience',
      'No production systems experience',
      'May struggle with applied work pace',
    ],
    reasoning: 'Strong researcher but lacks industry experience. History is purely academic with no applied ML work. High risk for production-focused role.',
  },
  {
    id: '10',
    name: 'Jennifer Lee',
    email: 'j.lee@email.com',
    currentRole: 'Data Analyst',
    currentCompany: 'Enterprise Corp',
    yearsExperience: 4,
    scores: { technical: 5, experience: 5, alignment: 5, growth: 6 },
    overallScore: 5.3,
    tier: 'below',
    strengths: [
      'SQL and dashboard experience',
      'Domain knowledge in finance',
    ],
    gaps: [
      'No ML engineering experience',
      'Python skills are basic',
      'Role mismatch - analytics vs engineering',
      'No relevant technical background',
    ],
    reasoning: 'Role mismatch. Current experience is in business analytics, not ML engineering. Would require significant career transition support.',
  },
];

// Generate more mock candidates for realistic demo
export function generateMockCandidates(count: number): Candidate[] {
  const firstNames = ['James', 'Emma', 'William', 'Olivia', 'Benjamin', 'Ava', 'Lucas', 'Sophia', 'Henry', 'Isabella', 'Alexander', 'Mia', 'Daniel', 'Charlotte', 'Matthew', 'Amelia', 'Joseph', 'Harper', 'Samuel', 'Evelyn'];
  const lastNames = ['Smith', 'Johnson', 'Williams', 'Brown', 'Jones', 'Garcia', 'Miller', 'Davis', 'Rodriguez', 'Martinez', 'Hernandez', 'Lopez', 'Gonzalez', 'Wilson', 'Anderson', 'Thomas', 'Taylor', 'Moore', 'Jackson', 'Martin'];
  const companies = ['Google', 'Meta', 'Amazon', 'Microsoft', 'Apple', 'Netflix', 'Stripe', 'Airbnb', 'Uber', 'Lyft', 'DoorDash', 'Coinbase', 'Databricks', 'Snowflake', 'Figma', 'Notion', 'Slack', 'Zoom', 'Square', 'Shopify'];
  const roles = ['ML Engineer', 'Senior ML Engineer', 'Staff ML Engineer', 'Data Scientist', 'Senior Data Scientist', 'Software Engineer', 'Research Scientist', 'ML Platform Engineer', 'AI Engineer', 'Applied Scientist'];

  const baseCandidates = [...mockCandidates];

  for (let i = baseCandidates.length; i < count; i++) {
    const firstName = firstNames[Math.floor(Math.random() * firstNames.length)];
    const lastName = lastNames[Math.floor(Math.random() * lastNames.length)];
    const company = companies[Math.floor(Math.random() * companies.length)];
    const role = roles[Math.floor(Math.random() * roles.length)];
    const years = Math.floor(Math.random() * 10) + 1;

    // Generate realistic scores with some randomness
    const baseScore = Math.random() * 5 + 4; // 4-9 base
    const technical = Math.min(10, Math.max(4, baseScore + (Math.random() - 0.5) * 2));
    const experience = Math.min(10, Math.max(4, baseScore + (Math.random() - 0.5) * 2));
    const alignment = Math.min(10, Math.max(4, baseScore + (Math.random() - 0.5) * 2));
    const growth = Math.min(10, Math.max(4, baseScore + (Math.random() - 0.5) * 2));
    const overall = (technical + experience + alignment + growth) / 4;

    let tier: Candidate['tier'];
    if (overall >= 9) tier = 'top';
    else if (overall >= 8) tier = 'strong';
    else if (overall >= 7) tier = 'moderate';
    else tier = 'below';

    baseCandidates.push({
      id: String(i + 1),
      name: `${firstName} ${lastName}`,
      email: `${firstName.toLowerCase()}.${lastName.toLowerCase()}@email.com`,
      currentRole: role,
      currentCompany: company,
      yearsExperience: years,
      scores: {
        technical: Math.round(technical * 10) / 10,
        experience: Math.round(experience * 10) / 10,
        alignment: Math.round(alignment * 10) / 10,
        growth: Math.round(growth * 10) / 10,
      },
      overallScore: Math.round(overall * 10) / 10,
      tier,
      strengths: tier === 'top' || tier === 'strong'
        ? ['Strong technical background', 'Relevant industry experience']
        : ['Some relevant skills'],
      gaps: tier === 'below' || tier === 'moderate'
        ? ['Experience gaps', 'Skills mismatch']
        : [],
      reasoning: `Candidate profile generated for demo. Overall score of ${Math.round(overall * 10) / 10} places them in the ${tier} tier.`,
    });
  }

  return baseCandidates;
}

export const sampleJD = `Senior Machine Learning Engineer

About the Role
We're looking for a Senior ML Engineer to join our AI team and help build the next generation of intelligent products. You'll work on challenging problems in natural language processing, recommendation systems, and computer vision.

Requirements
- 5+ years of software engineering experience, with 3+ years focused on ML
- Strong proficiency in Python and ML frameworks (PyTorch, TensorFlow)
- Experience building and deploying production ML systems
- BS/MS/PhD in Computer Science, Machine Learning, or related field
- Experience with distributed training and model optimization

Nice to Have
- Experience with LLMs and transformer architectures
- Published research or open source contributions
- Leadership experience mentoring junior engineers
- AWS or GCP cloud experience

What You'll Do
- Design and implement ML models for production use cases
- Build scalable ML infrastructure and pipelines
- Collaborate with product and engineering teams
- Mentor junior team members and contribute to technical direction`;

export const sampleIntakeNotes = `Intake call with hiring manager (Jane, VP Engineering):

Must-haves (non-negotiable):
- Production ML experience is critical - not just research
- Python is a must, PyTorch preferred over TensorFlow
- Someone who can work autonomously and move fast

What "good" looks like:
- Previous startup experience is a huge plus
- We want someone scrappy, not someone who needs a lot of process
- Communication skills matter - they'll present to execs

Red flags:
- Pure research background with no industry experience
- Someone who needs heavy management
- Candidates who seem rigid about process

Notes:
- Team is 5 people, will grow to 10 this year
- This person will eventually lead a pod
- Comp range is $250-300k + equity`;
