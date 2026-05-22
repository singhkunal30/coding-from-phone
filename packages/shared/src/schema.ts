import { Schema, MapSchema, ArraySchema, type } from '@colyseus/schema';

export class Vec2 extends Schema {
  @type('number') x: number = 0;
  @type('number') y: number = 0;
}

export class PlayerSchema extends Schema {
  @type('string') id: string = '';
  @type('string') name: string = '';
  @type('string') className: string = 'infiltrator';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') dirX: number = 0;
  @type('number') dirY: number = 1;
  @type('number') health: number = 100;
  @type('number') maxHealth: number = 100;
  @type('string') state: string = 'alive';
  @type('number') score: number = 0;
  @type('number') stolenValue: number = 0;
  @type('boolean') connected: boolean = true;
  @type('boolean') isCarryingLoot: boolean = false;
  @type('boolean') hasKeycard: boolean = false;
  @type('number') extractionProgress: number = 0;  // 0..1
  @type('number') reviveProgress: number = 0;      // 0..1 (incoming revive %)
  @type('number') lastInputSeq: number = 0;        // for client reconciliation
  @type(['string']) inventory = new ArraySchema<string>();
}

export class GuardSchema extends Schema {
  @type('string') id: string = '';
  @type('string') variant: string = 'patrol';      // GuardType
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') dirX: number = 1;
  @type('number') dirY: number = 0;
  @type('string') state: string = 'patrol';
  @type('number') alertLevel: number = 0;          // 0..100
  @type('number') health: number = 75;
  @type('string') targetPlayerId: string = '';
}

export class LootSchema extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') value: number = 0;
  @type('boolean') collected: boolean = false;
  @type('string') carrierId: string = '';
}

export class DoorSchema extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') angle: number = 0;               // 0 = horizontal, PI/2 = vertical
  @type('boolean') open: boolean = false;
  @type('boolean') locked: boolean = false;
  @type('boolean') requiresKeycard: boolean = false;
}

export class ExtractionZoneSchema extends Schema {
  @type('string') id: string = '';
  @type('number') x: number = 0;
  @type('number') y: number = 0;
  @type('number') radius: number = 3;
  @type('boolean') active: boolean = false;
}

export class WallSchema extends Schema {
  @type('number') x1: number = 0;
  @type('number') y1: number = 0;
  @type('number') x2: number = 0;
  @type('number') y2: number = 0;
}

export class MapSchemaState extends Schema {
  @type('number') width: number = 80;
  @type('number') height: number = 80;
  @type('number') seed: number = 0;
  @type([WallSchema]) walls = new ArraySchema<WallSchema>();
}

export class GameMessage extends Schema {
  @type('string') type: string = '';
  @type('string') text: string = '';
  @type('number') timestamp: number = 0;
}

export class HeistState extends Schema {
  @type('string') phase: string = 'lobby';
  @type('number') phaseEndsAt: number = 0;         // server timestamp ms
  @type('number') matchStartedAt: number = 0;
  @type('number') matchEndsAt: number = 0;
  @type('boolean') alarmActive: boolean = false;
  @type('number') alarmEndsAt: number = 0;
  @type('number') tick: number = 0;
  @type('number') serverTime: number = 0;          // for client clock sync
  @type('number') totalLootValue: number = 0;
  @type('number') extractedValue: number = 0;
  @type('number') difficulty: number = 1;

  @type({ map: PlayerSchema }) players = new MapSchema<PlayerSchema>();
  @type({ map: GuardSchema }) guards = new MapSchema<GuardSchema>();
  @type({ map: LootSchema }) loot = new MapSchema<LootSchema>();
  @type({ map: DoorSchema }) doors = new MapSchema<DoorSchema>();
  @type({ map: ExtractionZoneSchema }) extractionZones = new MapSchema<ExtractionZoneSchema>();
  @type(MapSchemaState) mapData = new MapSchemaState();
  @type([GameMessage]) recentMessages = new ArraySchema<GameMessage>();
}
