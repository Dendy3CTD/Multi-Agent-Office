# GFX-35: local living office

`/?gfx35=demo` runs one finite desk → lounge armchair → desk excursion in the real MAO Tower. Two other employees type and think independently. The badge explicitly labels this **local simulation**. No parameter, or `?gfx35=off`, keeps GFX-34's static GFX-32 characters. `?gfx32=legacy` keeps its existing static GLB fallback, including in demo mode. No unrigged seated model is moved around the floor.

This module has no network, agent-runtime, task creation, status mutation, model client, timers or RAF. Employee metadata remains authoritative. All visual variation uses a stable employee-ID seed, never names or sensitive attributes.

## Ownership and rendering

OfficeScene3D owns one renderer, one existing invalidation RAF, one AnimationScheduler and one controller per visible employee. The scheduler updates finite queues; it has no independent clock loop. Its `active` flag keeps the existing render callback alive only while necessary. Default speed is about 1.05 m/s with stable ID variation; delta is clamped to 50 ms. Visibility changes pause/reset the clock, so returning from a hidden tab cannot advance through a large time jump.

Reduced motion suppresses the demo at startup. Switching to reduced motion cancels optional activity in place; picking, elevator controls and camera remain available. Switching it off does not automatically start another excursion. Default mode has no extra idle render loop.

On content replacement or unmount: cancel queues, restore moved desk chairs, clear controllers/leases, remove visibility/media listeners through the existing scene lifecycle, dispose the shared-per-character skeleton once, then release refcounted character geometries/materials. There is no cloned walking actor and no invisible second employee.

## Rig and poses

GFX-32 still authors the same sculpted geometry. An opt-in third `createArtCharacter(data, prototype, true)` argument adds vertex skin weights **before** merging the body/head. Small elbow joint covers close the original open sleeve ends in articulated poses; they are merged into the existing body batch and exist only in the rigged variant. Sleeve weights use the authored surface parameter, so the end ring follows the forearm continuously. Two SkinnedMeshes share one 15-bone palette: pelvis, torso, head, paired thighs/shins/feet, upper arms/forearms/hands. The two top-level meshes, colors, stable appearance, semantic IDs and existing static fallback stay intact.

The original seated model is the bind pose. Anatomical pivots deform its actual vertices; standing is not a translated seated figure. Standing hips rise 0.29 m; knees and elbows use inexpensive analytic two-segment transforms. Walk phase follows distance travelled, with opposed legs/arms, planted-foot height, swing-foot lift and restrained torso bob. Hands rotate down when standing. Typing drives wrists/forearms with seeded pauses; thinking changes head and torso. Lounge sitting lowers the hands onto the lap. Chair roll makes room for rising; the chair returns before the pelvis lowers on the final sit.

Implemented states: SEATED_IDLE, SEATED_TYPING, SEATED_THINKING, STAND_UP, STANDING_IDLE, WALKING, TURNING, SIT_DOWN, LOUNGE_IDLE, RETURNING_TO_DESK. `SEATED_DRINKING` is a reserved type, not a fake gesture: requests return false / authored phases throw `unsupported_action:cup_attachment_not_implemented`. A real cup attachment/extraction pass is still needed.

A whole appended phase queue is validated atomically for allowed transitions, durations, path presence and continuous path starts. Each finite phase enters through a transition guard, updates, completes, and can be cancelled. Cancelling freezes current world transforms; return follows recorded breadcrumbs instead of teleporting. A blocked mover stops/cancels after two seconds, without an endless stationary render loop. No continuous idle cycles are scheduled after the finite demo.

## Navigation contract

`navigation-adapter.ts` consumes the actual `gfx34/navigation.ts` catalog. All 20 hub routes and their world coordinates remain unchanged. Desk-to-lounge travel joins existing desk/hub and lounge-entry/hub routes at their shared prefix. Existing routes to meeting/elevator remain available through `joinCatalogRoutes`; this pass authors the complete lounge scenario only.

Furniture transitions need short checked connectors because GFX-34 routes end at standing/entry points:

- desk chair → sideways exit → the existing desk stand anchor; only the owner's workplace collider is excluded during that furniture exit;
- lounge-entry → south side of the **actual armchair bounds** → chair seat; only the armchair is excluded in the final sitting segment.

All other segments sample the real architecture/decor collision bounds at 3.5 cm intervals with a 0.27 m actor radius. There is no parallel floor map. Missing or blocked connectors reject the excursion safely with an error; they do not teleport. The original navigation catalog is neither patched nor regenerated into another coordinate system.

Example Floor 02 anchors, read from that catalog (metres): desk 01 chair `(-5.2, .12, -3.23)`; stand `(-5.18975, .12, -2.45421)`; lounge entry `(-6.2, .12, -5.9)`; lounge armchair `(-7.3, .12, -5.2)`. Runtime code reads these values, rather than hardcoding a second copy.

Default `maxMoving=1` conservatively leases the corridor for one excursion. Configurable higher limits still reject overlapping route leases; a 0.62 m local separation check prevents walking through other registered actors. Multiple seated activities run independently. This is a small visible-floor system, not 113 background animation loops or a general crowd solver.

## Public API for GFX-36

```ts
import { AnimationScheduler } from './gfx35';
const animation = new AnimationScheduler({ catalog, obstacles, floorY, maxMoving: 1 });
animation.add({ employeeId, deskId, object: riggedCharacter, chair: actualChair });
animation.startExcursion(employeeId, actualLoungeChairBounds);
animation.activity(otherEmployeeId, 'SEATED_THINKING', 4);
// Wake the owning scene's existing invalidate callback after issuing commands.
// Inside that scene's existing render callback:
animation.tick(performance.now());
if (animation.active) invalidate();
// External lifecycle:
animation.cancel(employeeId);        // keep current pose and world position
animation.returnToDesk(employeeId); // reverse actually visited points
animation.setHidden(document.hidden);
animation.setReducedMotion(reduced);
animation.remove(employeeId);
animation.dispose();
```

`AnimationController.request`, `enqueue(Phase[])`, snapshots/history and the guarded state graph support future authored local scenarios. Paths passed directly to a low-level controller must already have been validated and reserved by the caller; prefer the scheduler for world movement. Commands never change Directory or agent task state. GFX-36 should keep that separation and call the scene's existing invalidation mechanism, not introduce another RAF.

Tests can call `step(dt)` or `advance(seconds)` without timers. DEV-only `?debug=1&gfx35=demo&gfx35Clock=manual` exposes `animation35` / `advance35(seconds)` through the existing `mao-3d-inspect` hook. Manual clock is intentionally ignored in production.

## Reproduction

From repository root:

```sh
corepack pnpm --filter @open-agent-office/office typecheck
corepack pnpm --filter @open-agent-office/office test
corepack pnpm --filter @open-agent-office/office build
node apps/office/src/office-3d/gfx35/browser-check.mjs
node apps/office/src/office-3d/gfx35/motion.browser-check.mjs
```

Mechanical browser checks use DPR 0.5 to bound software rasterization cost; saved full-size screenshots use DPR 1. The browser scripts use installed Chromium/CDP and the real main Tower. The motion script checks intermediate states/world transforms, two independent employees, exact return, unchanged statuses and zero requests **after initial assets load**. It writes eight close/full captures, a JSON trace and twelve genuine gait frames. It uses a deterministic simulation clock, not a fabricated FPS benchmark. Hardware Intel Iris Xe / Firefox performance is not inferred from SwiftShader.
