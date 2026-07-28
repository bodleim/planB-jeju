# Remaining Figma Frames Audit

## Audit scope

- Figma file: `SCSkw1BD5oCqz4TO6K0nv1`
- Source frames:
  - Frame 7 (`53:26`) and alternate Frame 8 (`57:133`): direct-speech bottom sheet
  - Frame 3 (`1:5`): itinerary result
  - Frame 6 (`28:5`): replace-time-slot bottom sheet
  - Frame 5 (`28:4`): candidate search results
- Implementation: `http://localhost:3000`
- Viewport: 393 × 852 CSS px
- State: 09:00–14:00, child companion, culture/indoor preference, first itinerary slot selected
- Review mode: combined visual, interaction, and screenshot-supported accessibility audit

## Overall verdict

Frame 1 remains the only screen that is visually close enough to the Figma source. The direct-speech sheet is partially matched, while the itinerary, replacement sheet, and candidate-search screens have P1 structural differences. No code was changed during this audit.

## Step 1 — Direct-speech sheet

- Health: **Needs adjustment**
- Comparison: `audit/remaining-pages/02-compare.png`
- Interaction: selecting an example opens a populated itinerary result.

### Findings

- [P2] The sheet begins about 13px lower than the Figma frame and is about 14px shorter, exposing more of the “누구와” section behind it.
- [P2] The third example copy differs:
  - Figma: “많이 안 걷고 차로 금방 가는 곳만”
  - Implementation: “많이 안 걷고 5시간 안에 도는 실내 위주로”
- [P3] The sheet controls and prompt row are close, but their exact vertical rhythm and control dimensions drift slightly from the source.
- Accepted difference: live weather values differ from the static Figma sample.

## Step 2 — Itinerary result

- Health: **Major mismatch**
- Comparison: `audit/remaining-pages/03-compare.png`
- Full implementation: `audit/remaining-pages/local/03-itinerary-full.png`
- Interaction: all three itinerary cards open their replacement state.

### Findings

- [P1] The Figma result is a complete 852px screen; the implementation is about 1,303px tall and requires substantial scrolling.
- [P1] The source keeps the three quick actions and prompt input visible at the bottom of the initial viewport. The implementation inserts category chips, a statistics panel, cost notes, confirmation CTA, rejected-candidate details, and long data-source notes.
- [P1] The source shows a compact “09:00–14:00” result. The implementation shows “09:00–13:50” because the generated plan ends early.
- [P2] Card widths, time-column spacing, and header density differ. The implementation cards are wider and the explanatory line wraps to two rows.
- Accepted difference: place names, travel times, images, and live map/weather data are dynamic product content.

## Step 3 — Replace-time-slot sheet

- Health: **Major mismatch**
- Comparison: `audit/remaining-pages/06-compare.png`
- Interaction: selecting an alternative replaces only the chosen slot and closes the sheet.

### Findings

- [P1] Figma uses a compact 271px sheet starting around y=581. The implementation uses a 521px sheet starting around y=331.
- [P1] Figma initially shows three intent chips and a prompt input. The implementation immediately shows a full alternative-place list.
- [P1] The source keeps the selected itinerary card visible and outlined behind the sheet; the implementation covers that region with the taller sheet.
- [P2] Header copy and information density differ materially from the source.

## Step 4 — Candidate search results

- Health: **Not cloned**
- Comparison: `audit/remaining-pages/05-compare.png`
- Interaction: submitting “카페” returns a filtered result and the selection action works.

### Findings

- [P1] The Figma design is a distinct full-screen search-results page with its own header, user request bubble, assistant summary, sorting/filter chips, ranked rows, and fixed prompt input.
- [P1] The implementation has no equivalent full-screen state. It filters the existing replacement bottom sheet down to a single row.
- [P1] The source’s sorting controls, disabled result state, recommendation explanation, and ranked-card structure are absent.

## Alternate Frame 8

Frame 8 is an alternate capture of the direct-speech sheet with a text “플랜B” header underneath. The implementation is closer to Frame 7, which uses the Plan B logo. No separate implementation state maps to Frame 8.

## Accessibility observations

### Confirmed strengths

- Bottom sheets expose named regions.
- Main action buttons have accessible names.
- Radio controls and time inputs are programmatically exposed.
- No browser console errors or warnings appeared during the audited flow.

### Risks

- [P2] The replacement-search input has no explicit accessible label and relies on placeholder text.
- [P2] Several touch targets are below 44px:
  - send buttons: 38 × 38px
  - replacement selection button: about 57 × 38px
  - refresh button: 40 × 40px
  - itinerary category chips: about 41px high
- Keyboard focus order, screen-reader announcements after navigation, and contrast ratios require a separate runtime accessibility test.

## Interaction checks

- Direct-speech example → itinerary result: passed.
- Itinerary card → replacement sheet: passed.
- Alternative selection → only selected slot replaced: passed.
- Replacement search → filtered result: passed.
- Browser console warnings/errors: none.

## Priority order

1. Build the distinct Frame 5 candidate-results page and connect it to the replacement prompt.
2. Restructure Frame 6 into the compact intent-first sheet.
3. Compress Frame 3 to the source’s single-screen composition.
4. Align Frame 7 sheet height, top position, and copy.

