import { parseWebhookPayload } from '../whatsapp/webhook-handler';

describe('parseWebhookPayload', () => {
  const makePayload = (message: object) => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'entry-1',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '123', phone_number_id: '456' },
              messages: [message],
            },
          },
        ],
      },
    ],
  });

  test('parses text message', () => {
    const payload = makePayload({
      id: 'msg-1',
      from: '584141234567',
      timestamp: '1700000000',
      type: 'text',
      text: { body: 'Hola, quiero ordenar' },
    });

    const { messages } = parseWebhookPayload(payload);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({
      messageId: 'msg-1',
      phone: '584141234567',
      type: 'text',
      text: 'Hola, quiero ordenar',
    });
  });

  test('parses button interactive reply', () => {
    const payload = makePayload({
      id: 'msg-2',
      from: '584141234567',
      timestamp: '1700000001',
      type: 'interactive',
      interactive: {
        type: 'button_reply',
        button_reply: { id: 'menu_browse', title: '🍔 Ver Menú' },
      },
    });

    const { messages } = parseWebhookPayload(payload);
    expect(messages[0]?.interactiveReply).toMatchObject({
      type: 'button_reply',
      id: 'menu_browse',
      title: '🍔 Ver Menú',
    });
  });

  test('parses image message', () => {
    const payload = makePayload({
      id: 'msg-3',
      from: '584141234567',
      timestamp: '1700000002',
      type: 'image',
      image: { id: 'media-abc', mime_type: 'image/jpeg' },
    });

    const { messages } = parseWebhookPayload(payload);
    expect(messages[0]).toMatchObject({
      type: 'image',
      imageId: 'media-abc',
    });
  });

  test('ignores non-message webhook objects', () => {
    const { messages } = parseWebhookPayload({ object: 'other', entry: [] });
    expect(messages).toHaveLength(0);
  });

  test('ignores status updates in messages array', () => {
    const payload = {
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'entry-1',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { display_phone_number: '123', phone_number_id: '456' },
                statuses: [
                  { id: 'msg-x', status: 'delivered', timestamp: '1700000003', recipient_id: '584' },
                ],
              },
            },
          ],
        },
      ],
    };

    const { messages, statuses } = parseWebhookPayload(payload);
    expect(messages).toHaveLength(0);
    expect(statuses).toHaveLength(1);
  });

  test('converts location to text', () => {
    const payload = makePayload({
      id: 'msg-4',
      from: '584141234567',
      timestamp: '1700000004',
      type: 'location',
      location: { latitude: 10.48, longitude: -66.87, name: 'Mi casa', address: 'Calle 5' },
    });

    const { messages } = parseWebhookPayload(payload);
    expect(messages[0]?.type).toBe('text');
    expect(messages[0]?.text).toContain('Calle 5');
  });
});
