import { IUserInterface, ReplyButtonDef, EventId } from "./user-interface";
import { isUndefined, isArray, isString } from "util";

export type Vars = {[key:string]: any};
export type ProcessFunction = (session: Session, ...args: any[]) => Promise<Vars>;
export type SessionMode = 'chat' | 'form';
export type GetInputType = 'string' | 'float' | 'int';

export type Process = (methods: SessionMethods, ...args: any[]) => Promise<any>;

export type SessionMethods = {
  setv(key: string, value: any): any,
  getv(key?: string | undefined | true): any,
  chat(text: string): Promise<void>,
  choose(choiceKey: string, buttons: ReplyButtonDef[] | CompactReplyActionsDef | string[]): Promise<any>,
  start(fn: Process | [Process, string], ...args: any[]): Promise<any>;
  getInput(resultKey: string, type?: GetInputType, re?: string, hintMessage?: string): Promise<string>;
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
    this.typing = isUndefined(typing) ? true : typing;
    this.localVars = this.globalVars;
    this.mode = mode || 'chat';
  }

  public async fetch(... keys: string[]): Promise<undefined | string> {
    console.log(`(Fake attempting to get keys: ${keys}`);
    // this should call an object supporting IBackendStorage or somesuch to abstract
    // away the loading of files.
    return undefined;
  }

  public async start(startArg: Process | [Process, string], ...args: any[]): Promise<Vars> {
    var [processFn, captureKey] = isArray(startArg) ? startArg : [startArg, null];
    const prevVars = this.localVars;
    if (captureKey) {
      this.localVars = this.localVars[captureKey] = {};
    }
    var result = await processFn(this.methods(processFn), ...args);
    this.localVars = prevVars;
    // this is a point at which results might be saved to backend
    return result;
  }

  public async pause(characterCount: number, ellipsis: boolean = true) {
    const typing = isUndefined(this.typing) ? this.typing : this.typing;
    const wordsPerSecond = (isUndefined(this.typingSpeed) ? this.typingSpeed : this.typingSpeed) / 60;
    const charactersPerSecond = 5 * wordsPerSecond;

    if (typing) {
      if (ellipsis) await this.userInterface.showEllipsis();
      const seconds = characterCount / charactersPerSecond;
      await timeout(seconds * 1000);
      if (ellipsis) await this.userInterface.hideEllipsis();
    }
  }

  public async chat(text: string) {
    await this.pause(text.length, true);
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
      this.setv(eventId[1], result);
    } else {
      if (this.eventId) {
        console.log(`Session received unexpected event ${eventId} which doesn't match expected event ${this.eventId}`);
      } else {
        console.log(`Session received ${eventId} when no event is expected.`);
      }
    }
  }

  public setv(key:string, value: any) {
    if (startsWithUpper(key[0])) {
      return this.globalVars[key] = value;
    } else {
      return this.localVars[key] = value;
    }
  }

  /**
   * Gets variables from the session store
   * @param key -
   *        lowercase first letter = local value
   *        uppercase first letter = global value
   *        undefined = return all local values
   *        true = return global values (which includes all local values)
   */
  public getv(key?: string | true) {
    if (isString(key)) {
      return (startsWithUpper(key[0])) ? this.globalVars[key] : this.localVars[key];
    } else if (key === true) {
      return this.globalVars;
    } else {
      return this.localVars;
    }
  }

  public async waitForUserEvent(eventId: [string, string], handler?: (result: any) => any): Promise<any> {
    const [, choiceKey] = this.eventId = eventId;
    this.eventResult = undefined;
    while (isUndefined(this.eventResult)) {
      await timeout(200);
    }
    const result = this.eventResult;
    this.setv(choiceKey, result);
    this.eventId = undefined;
    this.eventResult = undefined;
    if (handler) {
      await handler(result);
    }
    return result;
  }

  public methods(fn: Function): SessionMethods {
    const fnName = fn.name;
    const start = async (fn: Process | [Process, string], ...args: any[]) => { return await this.start(fn, ...args); }
    const setv = (key: string, value: any) => { return this.setv(key, value); }
    const getv = (key?: string | true) => { return this.getv(key); }
    const chat = async (text: string) => {
      return await this.chat(text);
    };

    const getInput = async (resultKey: string, type: GetInputType = 'string', re?: string, hintMessage?: string) => {
      const eventId: EventId = [fn.name, resultKey];
      await this.userInterface.getUserInput(eventId, type, re, hintMessage);
      const result = await this.waitForUserEvent(eventId, async (result: string) => result);
      return result;
    }

    const choose = async (choiceKey: string, buttons: ReplyButtonDef[] | CompactReplyActionsDef | string[]) => {
      const eventId: EventId = [fnName, choiceKey];
      const normalizedButtons = normalizeReplyButtons(buttons);
      await this.userInterface.showReplyButtons(eventId, normalizedButtons);
      const result = await this.waitForUserEvent(eventId, async (result: string) => {
        const button = normalizedButtons.find(b => b.result == result);
        if (button && button.do) {
          await button.do();
        }
      });
      return result;
    }
    return { chat, choose, setv, getv, start, getInput };
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

function startsWithUpper(key: string) {
  return /^[A-Z]/.test(key);
}