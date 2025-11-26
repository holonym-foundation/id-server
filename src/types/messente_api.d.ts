// Type declarations for messente_api package
// This package doesn't include TypeScript definitions, so we provide them here.

declare module 'messente_api' {
  // Authentication interface
  interface BasicAuth {
    type: 'basic';
    username?: string;
    password?: string;
  }

  // ApiClient class
  class ApiClient {
    static instance: ApiClient;
    authentications: {
      basicAuth: BasicAuth;
    };
    basePath: string;
    defaultHeaders: Record<string, string>;
    timeout: number;
    cache: boolean;
    enableCookies: boolean;
  }

  // SMS model
  interface SMS {
    text?: string;
    sender?: string;
    validity?: number;
  }

  class SMSConstructor {
    constructor(text?: string);
    static constructFromObject(data: { text?: string; sender?: string; validity?: number }): SMS;
  }

  // Viber model
  interface Viber {
    text?: string;
    sender?: string;
    validity?: number;
    imageUrl?: string;
    buttonUrl?: string;
    buttonText?: string;
  }

  class ViberConstructor {
    static constructFromObject(data: {
      text?: string;
      sender?: string;
      validity?: number;
      imageUrl?: string;
      buttonUrl?: string;
      buttonText?: string;
    }): Viber;
  }

  // WhatsAppText model
  interface WhatsAppText {
    text?: string;
    previewUrl?: boolean;
  }

  class WhatsAppTextConstructor {
    static constructFromObject(data: { text?: string; previewUrl?: boolean }): WhatsAppText;
  }

  // WhatsApp model
  interface WhatsApp {
    text?: WhatsAppText;
    image?: any;
    document?: any;
    audio?: any;
  }

  class WhatsAppConstructor {
    static constructFromObject(data: {
      text?: WhatsAppText;
      image?: any;
      document?: any;
      audio?: any;
    }): WhatsApp;
  }

  // Omnimessage model
  interface Omnimessage {
    to?: string;
    messages?: Array<SMS | Viber | WhatsApp>;
    textStore?: any;
    priority?: string;
  }

  class OmnimessageConstructor {
    constructor(to?: string, messages?: Array<SMS | Viber | WhatsApp>);
    static constructFromObject(data: {
      to?: string;
      messages?: Array<SMS | Viber | WhatsApp>;
      textStore?: any;
      priority?: string;
    }): Omnimessage;
  }

  // OmnimessageApi callback type
  type OmnimessageCallback = (
    error: any,
    data: any,
    response: any
  ) => void;

  // OmnimessageApi class
  class OmnimessageApi {
    constructor(apiClient?: ApiClient);
    sendOmnimessage(omnimessage: Omnimessage, callback: OmnimessageCallback): void;
    cancelScheduledMessage(omnimessageId: string, callback: OmnimessageCallback): void;
  }

  // Main export object
  const Messente: {
    ApiClient: typeof ApiClient;
    OmnimessageApi: typeof OmnimessageApi;
    SMS: typeof SMSConstructor;
    Viber: typeof ViberConstructor;
    WhatsApp: typeof WhatsAppConstructor;
    WhatsAppText: typeof WhatsAppTextConstructor;
    Omnimessage: typeof OmnimessageConstructor;
    // Add other exports as needed
    [key: string]: any;
  };

  export = Messente;
}

