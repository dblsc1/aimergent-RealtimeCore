# governance-promotion review

verdict: rejected

Exact target: `9061648118fb3f94b27226970b2c119d434a059d..d438e7a9ac967550704e96f2d2a9671f40705586`.

issues:

- P2 contract — `module_docs/rules.md:67`: it retains “真实持久化适配器…随首个消费方落地”, despite the candidate documenting that copycat is the first consumer and that an adapter exists but is not wired to production. Update the P5 route to the actual decision/state; otherwise the new governed documentation is internally contradictory.

Verified facts: `0/realtime_core` exists while `dev/realtime_core` does not; CONTRACTS-INDEX lines 13/33 and the three CI allowlists contain the module; copycat pins `#v1.0.1`, forwards only `transport/`, has an unused sqlite session adapter, and has no `defineMachine` import.
