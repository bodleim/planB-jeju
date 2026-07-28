# Frame 1 Design QA

## Comparison target

- Source visual truth: `public/figma/frame-1.png`
- Figma node: `1:3` in file `SCSkw1BD5oCqz4TO6K0nv1`
- Implementation screenshot: `audit/frame-1-implementation/04-production-393x852.jpg`
- iPhone 17 Pro screenshot: `audit/frame-1-implementation/06-production-iphone-17-pro-402x874.jpg`
- Full-view comparison: `audit/frame-1-implementation/05-reference-vs-production.png`
- State: Jeju Seongsan Port, 09:00–14:00, child companion selected, culture selected

## Viewport and normalization

- Source pixels and CSS target: 393 × 852 at 1×
- Figma comparison implementation: 393 × 852 CSS px and 393 × 852 captured pixels at 1×
- iPhone 17 Pro implementation: 402 × 874 CSS px and 402 × 874 captured pixels at 1×
- No density resampling was required for the 393 × 852 comparison.
- The source includes system status-bar chrome. The implementation leaves that chrome to iOS and compares app-owned content from the logo downward.

## Full-view comparison evidence

The final side-by-side comparison shows matching app-owned composition:

- 25px horizontal content margins
- logo, location, weather, section title, card, chip, and CTA vertical positions
- 92px time card, 36px time-adjust controls, 45px choice chips, and 64px CTAs
- two companion rows and two activity rows
- selected child and culture states
- complete screen fit with no vertical or horizontal overflow at 393 × 852 and 402 × 874

## Focused region evidence

A separate focused crop was not needed because the full 393 × 852 comparison is native-size and all text, borders, icons, and control states are legible. The exported Figma logo, cloud icon, and wind icon were also checked in their rendered slots.

## Required fidelity surfaces

- Fonts and typography: hierarchy, sizes, weights, wrapping, and alignment match the source closely. The implementation uses the iOS-first Korean system stack instead of downloading Noto Sans KR; this is accepted for device consistency.
- Spacing and layout rhythm: no actionable mismatch remains. The 393 × 852 screen fits exactly without scrolling; the 402 × 874 screen expands horizontally without changing row structure.
- Colors and visual tokens: navy, teal, pale mint, muted blue-gray, line, and orange state colors map to the Figma palette.
- Image quality and asset fidelity: the logo and two non-standard weather icons use exact downloaded Figma exports. No placeholder or hand-drawn replacement is used.
- Copy and content: section labels, chip labels, CTA labels, and selected states match. Weather values remain live product data, so temperature and wind can differ from the static Figma sample.

## Interaction verification

- Recent-history link selects couple and cafe: passed.
- +30 minute control updates the end time to 14:30: passed.
- Plan creation navigates to a populated itinerary from Seongsan Port: passed.
- Browser console warnings and errors: none.

## Comparison history

### Iteration 0

- Evidence: `audit/frame-1-clone-check/04-reference-vs-current.png`
- [P1] Extra location, interruption-cause, and travel/party sections changed the information architecture and extended the screen to about 1,089px.
- [P1] Native time inputs rendered locale-specific “AM” text and clock icons instead of the source time display.
- [P1] Companion and activity option sets did not match the Figma frame.
- Fixes: rebuilt the home composition from the Figma node, introduced the full option sets with domain mappings, replaced the visible native time UI, and applied measured frame spacing.

### Iteration 1

- Evidence: `audit/frame-1-implementation/02-iphone-17-pro-spacing-pass.jpg`
- [P2] The activity chips allowed four items on the first row at 402px.
- [P2] The lower sections and CTA group sat slightly above the source rhythm.
- Fixes: locked activity choices to three columns and adjusted the measured weather, time, companion, activity, and CTA gaps.

### Final iteration

- Evidence: `audit/frame-1-implementation/05-reference-vs-production.png`
- Post-fix result: no actionable P0, P1, or P2 visual differences remain.
- Accepted differences: iOS-owned status bar/corners and live weather values.

## Follow-up polish

- [P3] A bundled Noto Sans KR webfont could make non-iOS desktop rendering even closer, but the current iOS-first system font is preferable for the requested device.

Frame 1 result: passed

# Frames 3, 5, 6, and 7 Design QA

## Comparison target

- Source visual truth:
  - `public/figma/frame-3.png`
  - `public/figma/frame-5.png`
  - `public/figma/frame-6.png`
  - `public/figma/frame-7.png`
- Figma nodes: `1:5`, `28:4`, `28:5`, and `53:26` in file `SCSkw1BD5oCqz4TO6K0nv1`
- Browser-rendered implementation:
  - `audit/remaining-pages/local/03-itinerary-fixed.png`
  - `audit/remaining-pages/local/05-search-results-fixed.png`
  - `audit/remaining-pages/local/06-replace-sheet-fixed.png`
  - `audit/remaining-pages/local/02-direct-speech-sheet-fixed.png`
- iPhone 17 Pro implementation: `audit/remaining-pages/local/03-itinerary-iphone17pro.png`
- Full-view comparisons:
  - `audit/remaining-pages/03-compare-fixed.png`
  - `audit/remaining-pages/05-compare-fixed.png`
  - `audit/remaining-pages/06-compare-fixed.png`
  - `audit/remaining-pages/07-compare-fixed.png`
- State: Seongsan Port, 09:00–14:00, child companion, culture/indoor plan; first time slot selected for frames 5 and 6.

## Viewport and normalization

- Each Figma source and implementation comparison is 393 × 852 pixels at 1×, with a 393 × 852 CSS viewport.
- iPhone 17 Pro verification is 402 × 874 pixels at 1×, with a 402 × 874 CSS viewport.
- No density resampling was required.
- The Figma sources include iOS-owned status-bar and device-corner treatment. The implementation intentionally leaves system chrome to the device and compares app-owned content at the same viewport coordinates.

## Full-view and focused evidence

- Frame 3: the map/content boundary is at 213px; itinerary cards begin at 329, 450, and 571px; quick actions begin at 710px; the prompt begins at 758px. These match the source composition and the screen has no overflow.
- Frame 5: header ends at 117px, the user bubble is 336 × 78 at `(41, 134)`, filters occupy `295–353px`, results occupy `353–745px`, and the prompt is fixed at `745–852px`.
- Frame 6: the sheet is exactly 393 × 271 at `y=581`; suggestion chips begin at `y=696`; the 64px prompt begins at `y=765`; the selected itinerary card remains visible and outlined beneath the dim layer.
- Frame 7: the sheet is exactly 393 × 424 at `y=428`; example cards begin at `566`, `646`, and `706px`; the 59px prompt begins at `y=781`.
- Separate focused crops were not required because all four comparisons are native-size, side-by-side images and the typography, borders, imagery, controls, and copy are legible.

## Required fidelity surfaces

- Fonts and typography: sizes, hierarchy, weights, Korean wrapping, truncation, and line heights closely follow the Figma frames. The iOS-first Korean system stack is retained for the requested device.
- Spacing and layout rhythm: major section boundaries, card rows, prompt placement, radii, and vertical rhythm match. Both 393 × 852 and 402 × 874 fit without horizontal or vertical overflow.
- Colors and visual tokens: navy, teal, mint, orange, borders, dim opacity, selected filters, and disabled result states map to the source palette.
- Image quality and asset fidelity: the live itinerary and search states use the product's real Tourism Organization place photography. The Kakao map is rendered when available; the source's illustrative placeholder card art is treated as sample content rather than a production asset.
- Copy and content: frame-specific headings, helper copy, search filters, suggestion chips, and the third direct-speech example now match. Time values, place names, distances, and weather remain live product data and may differ from the static Figma sample.

## Interaction verification

- Opening an itinerary card presents the compact frame 6 replacement sheet: passed.
- Selecting “빙수 유명한 카페” opens the distinct frame 5 search results screen: passed.
- Search filters preserve the query and selected time slot: passed.
- Selecting an “추가” result returns to the itinerary and pins the selected place: passed.
- Direct-speech examples and free-text prompt remain interactive: passed.
- iPhone 17 Pro viewport: 402 × 874, three itinerary rows, quick actions, and prompt all remain visible; document height is exactly 874px.
- Browser console errors: none.
- Static checks: ESLint passed; TypeScript `--noEmit` passed.

## Comparison history

### Initial audit

- Evidence: `audit/remaining-pages/02-compare.png`, `03-compare.png`, `05-compare.png`, and `06-compare.png`.
- [P1] Frame 3 was a long diagnostic page instead of the 852px itinerary screen.
- [P1] Frame 5 did not exist as a separate search-results screen.
- [P1] Frame 6 was a 521px candidate list instead of the 271px prompt sheet.
- [P2] Frame 7 had the wrong third example and vertically shifted content.

### Final iteration

- Evidence: the four `*-compare-fixed.png` files listed above.
- Fixes: rebuilt the result composition at measured coordinates, split replacement and search into the Figma two-step flow, restored the compact replacement sheet, corrected direct-speech copy and spacing, and added 402 × 874 responsive placement.
- Post-fix result: no actionable P0, P1, or P2 differences remain.
- Accepted differences: device-owned status chrome and dynamic product data/map/place photography.

## Follow-up polish

- [P3] Static source illustrations and production place photography differ by design; preserving real product imagery is preferable for the working flow.

final result: passed
