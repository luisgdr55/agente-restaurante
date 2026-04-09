// Tipos compartidos del agente de conversación

export type { ConversationState, SessionData, CartItem } from '../redis/session-manager';

export interface IncomingMessage {
  messageId: string;
  phone: string;
  type: 'text' | 'image' | 'audio' | 'video' | 'document' | 'interactive' | 'sticker' | 'location';
  text?: string;
  imageId?: string;
  statusReplyId?: string; // ID del estado de WhatsApp al que el cliente respondió
  interactiveReply?: {
    type: 'button_reply' | 'list_reply';
    id: string;
    title: string;
  };
  timestamp: number;
}

export interface OutgoingMessage {
  to: string;
  type: 'text' | 'interactive' | 'image';
  text?: { body: string; preview_url?: boolean };
  interactive?: WhatsAppInteractive;
  image?: { id?: string; link?: string; caption?: string };
}

export interface WhatsAppInteractive {
  type: 'button' | 'list';
  header?: { type: 'text'; text: string };
  body: { text: string };
  footer?: { text: string };
  action: ButtonAction | ListAction;
}

export interface ButtonAction {
  buttons: Array<{
    type: 'reply';
    reply: { id: string; title: string };
  }>;
}

export interface ListAction {
  button: string;
  sections: Array<{
    title: string;
    rows: Array<{
      id: string;
      title: string;
      description?: string;
    }>;
  }>;
}
