# Office UI design

The office uses the supplied 1672×941 `office-four-person.png` room texture as
the single visual base. It keeps the Claude Office pixel palette, character
scale, chat, inspector, task board, notifications and metrics. The baked room
art already contains the four desks and chairs, so the app renders semantic
interaction hit zones rather than drawing a second furniture layer.

The room is a compact 2×2 plan: Director at upper-left, Developer at
upper-right, Engineer at lower-left and Analyst at lower-right. Percentage
anchors are measured against the texture's fixed aspect ratio, so the art and
all dynamic elements scale together without cropping or drift. Each station has
one semantic desk anchor, chair/sitting point and work destination in
`rooms.ts`; the physical desk and chair pixels come from the new background.

Movement uses percentage coordinates shared by furniture, spots and agents.
`rooms.ts` stores collision rectangles and `navigation.ts` uses an 8-neighbour
A* grid with an agent-radius clearance, diagonal corner-cutting prevention and
a swept segment check. The reducer repeats that check on every animation tick.

Character states remain data-driven: walking selects the original four
isometric facings and cycles walk sway; working shows the typing effect and
work animation; idle, coffee-break and resting/idle states are independent per
agent. The four-person simulation starts all four employees independently and
does not spawn a fifth desk.
