import { IUserInterface, ReplyButtonDef, EventId } from "./user-interface";
import { isUndefined, isArray, isString } from "util";

export type Vars = {[key:string]: any};
export type ProcessFunction = (session: Session, ...args: any[]) => Promise<Vars>;
export type SessionMode = 'chat' | 'form';

export type Process = (methods: SessionMethods, ...args: any[]) => Promise<any>;

export type SessionMethods = {
  setv(key: string, value: any): any,
  getv(key: string): any,
  chat(text: string): Promise<void>,
  choose(choiceKey: string, buttons: ReplyButtonDef[] | CompactReplyActionsDef | string[]): Promise<any>
};

export type CompactReplyActionsDef = { [choiceKey: string]: () => any };
export class Session {
  public readonly userInterface: IUserInterface;
  public typing: boolean;
  public typingSpeed: number;
  private eventResult?: any;
  private eventId?: EventId; // the event we're waiting for - only one at a time in this version
  private globalVars: Vars = {};
  private localVars: Vars;
  public readonly userEvents: [EventId, any][] = [];
  public readonly mode: SessionMode = 'chat';

  constructor({userInterface, typingSpeed, typing, mode }: {
    userInterface: IUserInterface,
    typingSpeed?: number,
    typing?: boolean,
    mode?: SessionMode
  }) {
    this.userInterface = userInterface;
    this.typingSpeed = typingSpeed || 100;
    this.typing = typing ||  true;
    this.localVars = this.globalVars;
    this.mode = mode || 'chat';
  }

  public async start(startArg: Process | [Process, string], ...args: any[]): Promise<Vars> {
    var [processFn, captureKey] = isArray(startArg) ? startArg : [startArg, null];
    const prevVars = this.localVars;
    if (captureKey) {
      this.localVars = this.localVars[captureKey] = {};
    }
    var result = await processFn(this.methods(processFn), ...args);
    result = isUndefined(result) ? this.localVars : result;
    this.localVars = prevVars;
    // this is a point at which results might be saved to backend
    return result;
  }

  public async chat(text: string) {
    const typing = isUndefined(this.typing) ? this.typing : this.typing;
    const wordsPerSecond = (isUndefined(this.typingSpeed) ? this.typingSpeed : this.typingSpeed) / 60;
    const charactersPerSecond = 5 * wordsPerSecond;

    if (typing) {
      await this.userInterface.showEllipsis();
      const seconds = text.length / charactersPerSecond;
      await timeout(seconds * 1000);
      await this.userInterface.hideEllipsis();
    }
    await this.userInterface.showText(text);
    return;
  }

  /**
   * For now, a super-simple implementation which only checks the event
   * is correct and sets the result.
   * @param event
   * @param result
   */
  public async handleEvent(eventId: EventId, result: any) {
    if (eventId === this.eventId) {
      this.userEvents.push([eventId, result]);
      this.eventResult = result;
      this.eventId = undefined;
    } else {
      if (this.eventId) {
        console.log(`Session received unexpected event ${eventId} which doesn't match expected event ${this.eventId}`);
      } else {
        console.log(`Session received ${eventId} when no event is expected.`);
      }
    }
  }

  public setv(key:string, value: any) {
    if (/^[A-Z]/.test(key[0])) {
      return this.globalVars[key] = value;
    } else {
      return this.localVars[key] = value;
    }
  }

  public getv(key: string) {
    return (/^[A-Z]/.test(key[0])) ? this.globalVars[key] : this.localVars[key];
  }

  public async waitForUserEvent(eventId: EventId): Promise<any> {
    const [, choiceKey] = this.eventId = eventId;
    this.eventResult = undefined;
    while (isUndefined(this.eventResult)) {
      await timeout(200);
    }
    const result = this.eventResult;
    this.setv(choiceKey, result);
    this.eventResult = undefined;
    return result;
  }

  public methods(fn: Function): SessionMethods {
    const fnName = fn.name;
    const setv = (key: string, value: any) => { return this.setv(key, value); }
    const getv = (key: string) => { return this.getv(key); }
    const chat = async (text: string) => {
      return await this.chat(text);
    };
    const choose = async (choiceKey: string, buttons: ReplyButtonDef[] | CompactReplyActionsDef | string[]) => {
      const eventId: EventId = [fnName, choiceKey];

      await this.userInterface.showReplyButtons(eventId, normalizeReplyButtons(buttons));
      await this.waitForUserEvent(eventId);
    }
    return { chat, choose, setv, getv };
  }
}

function normalizeReplyButtons(buttons: any): ReplyButtonDef[] {
  if (isArray(buttons)) {
    if (buttons.every(isString)) {
      return buttons.map(key => {
        return { text: key, result: key };
      });
    } else if (buttons.every(b => isString(b['result']) && isString(b['text']))) {
      return buttons;
    }
  } else if (typeof buttons === 'object') {
    return Object.keys(buttons).map(key => {
      return {
        text: key,
        result: key,
        do: buttons[key]
      };
    });
  }
  throw new Error(`invalid button definition: ${JSON.stringify(buttons)}`);
}

export function timeout(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
