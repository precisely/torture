import { Session, SessionMode, Process, Vars } from './session';
import * as readline from 'readline';
import * as readlineSync from 'readline-sync';
import { IUserInterface, ReplyButtonDef, EventId } from "./user-interface";
import { isNumber } from "util";

export class TortureChamber implements IUserInterface {
  public readonly session: Session;
  constructor(mode: SessionMode = 'chat') {
    this.session = new Session({
      userInterface: this,
      mode
    });
  }
  private ellipsis?: string[];

  async start(startArg: Process | [Process, string], ...args: any[]): Promise<Vars> {
    return await this.session.start(startArg, ...args);
  }

  async showForm(form: any) {
    console.log(`Unable to show form ${form} - not implemented`);
  }

  async showReplyButtons(eventId: EventId, buttons: ReplyButtonDef[]) {
    buttons.forEach((button, index) => {
      console.log(`${index+1}) ${button.text}`);
    });

    var selection;
    do {
      selection = readlineSync.questionInt(`Enter a number from 1 to ${buttons.length}`);
    } while (!isNumber(selection) || selection<1 || selection>buttons.length);

    await this.session.handleEvent(eventId, buttons[selection - 1].result);
  }

  async showText(text: string) {
    console.log(text);
  }

  async showEllipsis() {
    this.ellipsis = ['.ooo', 'o.oo', 'oo.o', 'ooo.'];
    setTimeout(() => this.animateEllipsis(), 500);
  }
  async hideEllipsis() {
    readline.clearLine(process.stdout, -1);  // clear current text
    readline.cursorTo(process.stdout, 0);
    this.ellipsis = undefined;
  }

  private animateEllipsis() {
    if (this.ellipsis) {
      overwrite(this.ellipsis[0]);
      this.ellipsis.push(this.ellipsis.shift() || '...');
      setTimeout(() => this.animateEllipsis(), 400);
    }
  }
}

function overwrite(text: string) {
  readline.clearLine(process.stdout, -1);  // clear current text
  readline.cursorTo(process.stdout, 0);
  process.stdout.write(text);
}