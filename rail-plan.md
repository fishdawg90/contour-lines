# Pocket Logistics railway implementation plan

## First playable railway

A service shuttles between two stations. Track and service have separate identities so several services can use the same infrastructure. A through station can connect an onward section. Locomotives on the same train contribute tractive effort and power together. Buying a second train creates an independently dispatched service vehicle.

| Work package | Design and integration | Acceptance check |
| --- | --- | --- |
| Construction | Offer road and rail in New route. Build a two-stop line using terrain, station placement and alignment conventions from the road editor. Price new infrastructure and show which existing sections will be reused before commitment. Store ordered section IDs and oriented route geometry. | Build a route, reuse it in the reverse direction, and cancel a draft without spending money. |
| Stations and junctions | Give stations and track sections persistent IDs. A terminal ends a branch. A through station admits a continuation. Each selected section must connect to the next. A visual crossing alone never joins two sections. Allow optional double track. | Extend from a through station, reject an invalid connection, and check opposing movements on single and double track. |
| Train construction | Build an ordered consist from locomotives and matching passenger or freight cars. Use compact steppers, a consist graphic, loaded mass, capacity, predicted performance and price. Compare one extra wagon with one extra engine before buying. | Change a consist, check capacity and cost, buy another train, and retire one. |
| Motion and dispatch | Use distance along sampled track, metres and seconds internally. Limit starting pull by tractive effort and power at speed. Calculate net force from loaded mass, slope, rolling resistance and drag. Use curvature and stopping distance to anticipate slowing. Reserve shared track before departure. Sample each vehicle along the same path so cars follow bends. | Compare empty and loaded performance on a grade, single and double heading, braking at a bend and a station, and conflicting reservations. |
| Economy and persistence | Extend the existing fleet, cargo, passenger and accounting systems. Store consist and trip state beside each vehicle. Keep old road services readable. Preserve stock, reservations and expenditure when editing, retiring or deleting. | Complete an economic trip, save and reload mid-service, remove one of two routes sharing track, and verify a road-only save. |
| Map and management | Adapt the timber rail depot from the asset lab. Add locomotives, coaches, wagons, tracks and platform details at the game's scale. Extend the existing list, detail panel, filters and overlays with rail. Keep one primary action and one guidance line within the current step. | Follow the normal new-game flow, build and manage rail on a phone viewport, and open an existing road service through the same inspector. |

## First-version operating choices

Reserve an entire conflicting section itinerary before departure. This gives shared single track predictable behaviour without requiring players to install signals. Use the direction of travel to select the lane on doubled track. Keep scheduled services point-to-point even when their path uses intermediate infrastructure. Price a second locomotive separately from a second operating train.

## Verification sequence

1. Run syntax and deterministic simulation checks against the implementation.
2. Exercise construction and management through the browser, including narrow-screen controls.
3. Check save compatibility, shared infrastructure and deletion, then publish the integrated update to the existing game URL.
