export class CampaignNotFoundError extends Error {
  constructor(campaignId: string) {
    super(`Campaign not found: ${campaignId}`);
    this.name = "CampaignNotFoundError";
  }
}

export class RevisionConflictError extends Error {
  constructor(
    public readonly campaignId: string,
    public readonly expectedRevision: number,
    public readonly actualRevision: number
  ) {
    super(
      `Campaign ${campaignId} revision conflict: expected ${expectedRevision}, actual ${actualRevision}`
    );
    this.name = "RevisionConflictError";
  }
}

export class SequenceConflictError extends Error {
  constructor(eventId: string, expected: number, actual: number) {
    super(
      `Event ${eventId} has sequence ${actual}; expected contiguous sequence ${expected}`
    );
    this.name = "SequenceConflictError";
  }
}

export class ConflictingReplayError extends Error {
  constructor(eventId: string) {
    super(`Event ${eventId} was replayed with different immutable content`);
    this.name = "ConflictingReplayError";
  }
}

export class MixedReplayError extends Error {
  constructor() {
    super("An append batch cannot mix replayed and new campaign events");
    this.name = "MixedReplayError";
  }
}

export class InvalidCampaignTransitionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidCampaignTransitionError";
  }
}

export class TerminalCampaignError extends Error {
  constructor(campaignId: string) {
    super(`Campaign ${campaignId} is terminal and cannot accept semantic events`);
    this.name = "TerminalCampaignError";
  }
}

export class ReceiptIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReceiptIdentityError";
  }
}
