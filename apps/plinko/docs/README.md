# One-Eyed Willy's Plinko — documentation

Reference documentation for the Plinko bonus feature: how it works, every tunable value, and the
probability each value implies.

| Document | Contents |
| --- | --- |
| [bonus-mode.md](bonus-mode.md) | How bonus mode works end to end — entry paths, the level ladder, free balls, the in-bonus free spin, exit and settlement. |
| [bonus-values.md](bonus-values.md) | Every defined value and derived probability, per mode. The tables here are the shipped configuration. |
| [unified-levelup-proposal.md](unified-levelup-proposal.md) | Why the level-up ladder is shared by all 7 feature modes and the per-mode coin-peg probability is the RTP lever — the investigation, the rejected alternatives, and the verification still outstanding. |

## Where the numbers actually live

The math SDK is authoritative. The web client mirrors a subset for display and for offline/dev play,
but every live round is driven by the book the RGS returns.

| Concern | Source of truth |
| --- | --- |
| Board multipliers, meter maxima, level ladder, ball awards, wheel values, per-mode RTP/quota | `stake-math-sdk/games/crimson_plinko/plinko_data.py` |
| Bet modes, distributions, per-mode conditions | `stake-math-sdk/games/crimson_plinko/game_config.py` |
| Round simulation (drop walk, meters, bonus round) | `stake-math-sdk/games/crimson_plinko/game_calculations.py` |
| Book event shapes | `stake-math-sdk/games/crimson_plinko/game_events.py` |
| Client mirrors of the tunables | `apps/plinko/src/game-logic/constants.ts` |
| Client bonus playback / level-up timing | `apps/plinko/src/game/gameOrchestrator.ts`, `apps/plinko/src/game/meterFlow.ts` |

Any change to a value in `plinko_data.py` needs `make run GAME=crimson_plinko` (regenerates books,
lookup tables and `config_fe_*.json`), then `sync-math-books`, then the matching edit to
`constants.ts` where the client mirrors it.
