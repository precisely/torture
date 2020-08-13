export type EventId = [string, string];
export type ReplyButtonDef = { text: string, result: string, do?: () => any };
export type FormDef = {}; // TODO some representatio of FORM input capabilities
export interface IUserInterface {
  showForm(form: any): Promise<void>;
  showReplyButtons(eventId: EventId, buttons: ReplyButtonDef[]): Promise<void>;
  showText(text: string): Promise<void>;
  showEllipsis(): Promise<void>;
  hideEllipsis(): Promise<void>;
}