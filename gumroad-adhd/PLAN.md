# Gumroad Product Plan — "Wired Different: The ADHD Success Playbook"

## Product overview

- **Format:** Ebook (Markdown → PDF/EPUB for Gumroad), ~12 chapters, 2,000–3,000 words each
- **Audience:** English-speaking adults (25–45) with diagnosed or suspected ADHD who want practical career/business/life systems — not medical advice
- **Positioning:** Written by someone who treats ADHD as a different operating system, not a defect. Practical, warm, zero toxic positivity, zero "just try harder"
- **Price target:** $19–$29 on Gumroad
- **Language:** English (US)

## Voice guide

- First person, conversational but not sloppy
- Short paragraphs. Concrete examples over abstractions
- Never promise cures. Always frame as "what worked / what tends to work"
- Include a "Try this today" box at the end of every chapter
- Standard disclaimer: this is lived-experience + research-informed self-help, not medical advice; readers should work with clinicians for treatment decisions

## Chapter outline & status

| # | Chapter | Status |
|---|---------|--------|
| 1 | Your Brain Isn't Broken: Reframing ADHD as an Operating System | ✅ done |
| 2 | The Interest-Driven Nervous System: Why Willpower Advice Fails You | ⬜ next |
| 3 | Externalize Everything: Building a Second Brain That Actually Sticks | ⬜ |
| 4 | Time Blindness: Making Time Visible, Physical, and Loud | ⬜ |
| 5 | The Two-Minute Lie: Task Initiation and How to Actually Start | ⬜ |
| 6 | Hyperfocus as a Superpower (and How Not to Get Burned by It) | ⬜ |
| 7 | Body Doubling, Accountability, and Borrowing Other People's Executive Function | ⬜ |
| 8 | Money and ADHD: Impulse Spending, Invisible Bills, Automation | ⬜ |
| 9 | Careers That Fit: Choosing Work That Rewards Your Wiring | ⬜ |
| 10 | Emotional Regulation and Rejection Sensitivity at Work | ⬜ |
| 11 | Building Routines That Survive the Novelty Cliff | ⬜ |
| 12 | Your Personal Operating Manual: Putting It All Together | ⬜ |

## Automation workflow (for the recurring session)

Each run:
1. Read this PLAN.md and the latest finished chapter for continuity
2. Write the next ⬜ chapter into `chapters/NN-slug.md` (2,000–3,000 words, follow the voice guide)
3. Mark it ✅ here, commit, push to `claude/gumroad-adhd-auto-content-53bvm1`
4. When all 12 are ✅: write front matter (title page, intro, disclaimer) and a Gumroad listing draft (`gumroad-listing.md`), then stop the routine
