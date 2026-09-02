import {
  CampaignEventV1Schema,
  canonicalJson,
  type CampaignEventV1
} from "@summer/protocol";

import {
  ConflictingReplayError,
  MixedReplayError,
  RevisionConflictError,
  SequenceConflictError
} from "./errors.js";
import { reduceCampaign, type CampaignProjection } from "./projection.js";

export interface CampaignRecord {
  readonly projection: CampaignProjection;
  readonly events: readonly CampaignEventV1[];
}

export interface AppendResult extends CampaignRecord {
  readonly appended: number;
  readonly replayed: boolean;
}

export interface CampaignLedger {
  read(campaignId: string): CampaignRecord | null;
  append(
    campaignId: string,
    expectedRevision: number,
    events: readonly CampaignEventV1[]
  ): AppendResult;
}

interface MutableRecord {
  projection: CampaignProjection;
  events: CampaignEventV1[];
}

function cloneRecord(record: MutableRecord): CampaignRecord {
  return structuredClone(record);
}

export class InMemoryCampaignLedger implements CampaignLedger {
  readonly #records = new Map<string, MutableRecord>();

  read(campaignId: string): CampaignRecord | null {
    const record = this.#records.get(campaignId);
    return record === undefined ? null : cloneRecord(record);
  }

  append(
    campaignId: string,
    expectedRevision: number,
    inputEvents: readonly CampaignEventV1[]
  ): AppendResult {
    if (inputEvents.length === 0) {
      const existing = this.#records.get(campaignId);
      if (existing === undefined) {
        throw new RevisionConflictError(campaignId, expectedRevision, 0);
      }
      if (expectedRevision !== existing.projection.revision) {
        throw new RevisionConflictError(
          campaignId,
          expectedRevision,
          existing.projection.revision
        );
      }
      return { ...cloneRecord(existing), appended: 0, replayed: false };
    }

    const events = inputEvents.map((event) =>
      structuredClone(CampaignEventV1Schema.parse(event))
    );
    const eventIds = new Set<string>();
    for (const event of events) {
      if (event.campaignId !== campaignId) {
        throw new Error(
          `Event ${event.eventId} belongs to ${event.campaignId}, not append target ${campaignId}`
        );
      }
      if (eventIds.has(event.eventId)) {
        throw new ConflictingReplayError(event.eventId);
      }
      eventIds.add(event.eventId);
    }

    const existing = this.#records.get(campaignId);
    const existingById = new Map(
      existing?.events.map((event) => [event.eventId, event] as const) ?? []
    );
    const replayMatches = events.map((event) => {
      const prior = existingById.get(event.eventId);
      if (prior === undefined) return false;
      if (canonicalJson(prior) !== canonicalJson(event)) {
        throw new ConflictingReplayError(event.eventId);
      }
      return true;
    });
    if (replayMatches.every(Boolean)) {
      if (existing === undefined) {
        throw new Error("Invariant violation: replay events require an existing record");
      }
      return { ...cloneRecord(existing), appended: 0, replayed: true };
    }
    if (replayMatches.some(Boolean)) {
      throw new MixedReplayError();
    }

    const actualRevision = existing?.projection.revision ?? 0;
    if (expectedRevision !== actualRevision) {
      throw new RevisionConflictError(
        campaignId,
        expectedRevision,
        actualRevision
      );
    }

    let projection = existing?.projection ?? null;
    const appended: CampaignEventV1[] = [];
    for (const [index, event] of events.entries()) {
      const expectedSequence = actualRevision + index;
      if (event.sequence !== expectedSequence) {
        throw new SequenceConflictError(
          event.eventId,
          expectedSequence,
          event.sequence
        );
      }
      projection = reduceCampaign(projection, event);
      appended.push(event);
    }
    if (projection === null) {
      throw new Error("Invariant violation: append did not create a projection");
    }

    const record: MutableRecord = {
      projection,
      events: [...(existing?.events ?? []), ...appended]
    };
    this.#records.set(campaignId, record);
    return {
      ...cloneRecord(record),
      appended: appended.length,
      replayed: false
    };
  }
}
