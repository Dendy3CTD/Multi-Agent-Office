export interface SlotPolicyInput {
  readonly requestedTarget?: number;
  readonly budgetStatus: "normal" | "warning" | "critical" | "blocked" | "unknown";
  readonly subscriptionStatus?: "available" | "warning" | "blocked" | "unknown";
  readonly runtimeConcurrency?: number | null;
}

export interface SlotPolicyDecision {
  readonly slots: number;
  readonly baseline: 2;
  readonly maximum: 20;
  readonly reason: string;
}

export class DynamicSlotPolicy {
  readonly baseline = 2 as const;
  readonly maximum = 20 as const;

  compute(input: SlotPolicyInput): SlotPolicyDecision {
    // Input validation happens before the blocked short-circuit: a policy must
    // never silently accept malformed input just because it is currently blocked.
    const requested = input.requestedTarget ?? this.baseline;
    if (!Number.isInteger(requested) || requested < 0) throw new TypeError("requestedTarget must be a non-negative integer");
    if (input.runtimeConcurrency !== null && input.runtimeConcurrency !== undefined && (!Number.isInteger(input.runtimeConcurrency) || input.runtimeConcurrency < 0)) throw new TypeError("runtimeConcurrency must be null or a non-negative integer");
    if (input.budgetStatus === "blocked" || input.subscriptionStatus === "blocked") return { slots: 0, baseline: 2, maximum: 20, reason: "budget or subscription policy is blocked" };
    let slots = Math.min(this.maximum, Math.max(0, requested));
    if (input.runtimeConcurrency !== null && input.runtimeConcurrency !== undefined) slots = Math.min(slots, input.runtimeConcurrency);
    return { slots, baseline: 2, maximum: 20, reason: slots < requested ? "capped by policy or runtime capacity" : "within configured policy" };
  }
}
