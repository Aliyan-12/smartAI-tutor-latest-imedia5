# Data Protection Impact Assessment (DPIA) — scaffold

> DRAFT. A DPIA is required because the service processes children's personal data and involves
> profiling (progress/mastery). Complete with the DPO before launch.

## 1. Describe the processing
- Nature: AI tutoring, lesson booking, assessments, progress/mastery, billing, voice sessions.
- Scope: UK KS1–KS5 students; parents; teachers; school tenants.
- Context: online service **likely accessed by children** → ICO Age Appropriate Design Code.
- Purposes: deliver personalised lessons; safeguarding; billing; service improvement.

## 2. Necessity & proportionality
- Lawful bases: contract, legal obligation (safeguarding/finance), legitimate interests (balanced).
- Data minimisation: [list fields collected and justify each].
- Children's best interests: default to protective settings; no unnecessary profiling.

## 3. Risks to individuals
| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|-----------|
| Excessive data on children | | | data minimisation, retention limits |
| AI inaccuracy affecting a child | | | AI-use notice, human oversight, reports |
| Unauthorised access | | | RBAC, tenant isolation, encryption, audit |
| Third-party asset requests leaking IP | | | self-host emoji/assets (see THIRD_PARTY_NOTICES) |
| Profiling harms | | | transparency, parental visibility, objection right |

## 4. Measures & sign-off
- Measures: [encryption, access control, retention automation, DSAR workflow, breach plan].
- Residual risk: [ ] · DPO sign-off: __________ · Date: __________
