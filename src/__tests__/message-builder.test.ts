import { textMessage, buttonMessage, listMessage, TEMPLATES } from '../whatsapp/message-builder';

describe('message-builder', () => {
  test('textMessage returns correct structure', () => {
    const msg = textMessage('5841234', 'Hola!');
    expect(msg).toEqual({
      to: '5841234',
      type: 'text',
      text: { body: 'Hola!' },
    });
  });

  test('buttonMessage throws when > 3 buttons', () => {
    expect(() =>
      buttonMessage('5841234', 'body', [
        { id: '1', title: 'A' },
        { id: '2', title: 'B' },
        { id: '3', title: 'C' },
        { id: '4', title: 'D' },
      ]),
    ).toThrow();
  });

  test('buttonMessage truncates titles > 20 chars', () => {
    const msg = buttonMessage('5841234', 'body', [
      { id: '1', title: 'This title is way too long for WhatsApp' },
    ]);
    const btn = (msg.interactive?.action as { buttons: Array<{ reply: { title: string } }> }).buttons[0];
    expect(btn?.reply.title.length).toBeLessThanOrEqual(20);
  });

  test('listMessage truncates row titles > 24 chars', () => {
    const msg = listMessage('5841234', 'body', 'Ver', [
      {
        title: 'Section',
        rows: [{ id: '1', title: 'A very long row title that exceeds limit' }],
      },
    ]);
    const section = (msg.interactive?.action as { sections: Array<{ rows: Array<{ title: string }> }> })
      .sections[0];
    expect(section?.rows[0]?.title.length).toBeLessThanOrEqual(24);
  });

  test('TEMPLATES.mainMenu builds valid button message', () => {
    const msg = TEMPLATES.mainMenu('5841234', 'Luis');
    expect(msg.type).toBe('interactive');
    expect(msg.interactive?.type).toBe('button');
    expect(msg.to).toBe('5841234');
    const action = msg.interactive?.action as { buttons: unknown[] };
    expect(action.buttons).toHaveLength(3);
  });

  test('TEMPLATES.orderConfirmation builds correct total', () => {
    const msg = TEMPLATES.orderConfirmation(
      '5841234',
      [
        { name: 'Big Burger', quantity: 2, subtotalBs: 474.50, subtotalUsd: 13.00 },
        { name: 'Nestea', quantity: 1, subtotalBs: 54.75, subtotalUsd: 1.50 },
      ],
      529.25,
      14.50,
    );
    expect(msg.interactive?.body.text).toContain('529.25');
    expect(msg.interactive?.body.text).toContain('2x Big Burger');
  });
});
