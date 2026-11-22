import type { Bot, Context } from 'grammy';
import { statusLabels, type LeadStatus } from '../../domain/status.js';
import { LeadAccessError, LeadNotFoundError, LeadValidationError } from '../../services/lead-service.js';
import type { StaffOperation, StaffRole, TelegramStaffService } from '../../services/telegram-staff-service.js';
import { buildLeadCard, buildLeadKeyboard, guardTelegramText } from './card.js';

const staffHelp = [
  '/queue — открытые заявки',
  '/lead НОМЕР — карточка и последние комментарии',
  '/note НОМЕР ТЕКСТ — внутренний комментарий',
  '/assign НОМЕР ID — назначить сотрудника из списка',
  '/price НОМЕР СУММА — итоговая сумма BYN',
  '/paid НОМЕР — подтвердить полную оплату',
  '/report — воронка и факт оплаты по источникам за 7 дней',
  '/delivery — состояние очередей Telegram для администратора',
].join('\n');

export function registerStaffCommands(bot: Bot, staff: TelegramStaffService, roles: ReadonlyMap<string, StaffRole>) {
  const actor = (context: Context) => String(context.from?.id ?? '');
  bot.command('staff', (context) => context.reply(staffHelp));
  bot.command('queue', async (context) => {
    const rows = await staff.queue(actor(context));
    await context.reply(guardTelegramText(rows.map((row) =>
      `#${row.publicId} · ${statusLabels[row.status as LeadStatus]} · ${row.service || 'без услуги'}`,
    ).join('\n') || 'Открытых заявок нет.'));
  });
  bot.command('lead', async (context) => {
    try {
      const lead = await staff.find(context.match.trim().replace(/^#/, '').toUpperCase(), actor(context));
      const notes = await staff.notes(lead.id);
      await context.reply(guardTelegramText([buildLeadCard(lead, true), ...notes.map((note) => `Внутренний комментарий: ${note}`)].join('\n')),
        { reply_markup: buildLeadKeyboard(lead, true) });
    } catch (error) {
      await context.reply(staffError(error));
    }
  });
  bot.callbackQuery(/^take:([0-9a-f-]{36})$/i, async (context) => {
    const leadId = context.match[1];
    if (!leadId) return;
    try {
      await staff.apply(leadId, { kind: 'assigned', assignee: actor(context) }, actor(context), `callback:${context.callbackQuery.id}`);
      await context.answerCallbackQuery({ text: 'Вы назначены ответственным.' });
    } catch (error) {
      await context.answerCallbackQuery({ text: staffError(error) });
    }
  });
  for (const command of ['assign', 'note', 'price', 'paid'] as const) {
    bot.command(command, async (context) => {
      if (!context.message) return;
      const match = /^#?(BSE-\d{8}-[A-F0-9]{8})(?:\s+([\s\S]+))?$/i.exec(context.match.trim());
      if (!match?.[1] || (command !== 'paid' && !match[2])) {
        await context.reply('Проверьте номер заявки и аргументы. Команды: /staff.');
        return;
      }
      const value = match[2]?.trim() ?? '';
      const operations: Record<typeof command, StaffOperation> = {
        assign: { kind: 'assigned', assignee: value },
        note: { kind: 'note_added', text: value },
        price: { kind: 'price_set', amount: value.replace(',', '.') },
        paid: { kind: 'payment_recorded' },
      };
      try {
        const lead = await staff.apply(match[1].toUpperCase(), operations[command], actor(context), `message:${context.message.message_id}`);
        await context.reply(`Обновлено #${lead.publicId}.`);
      } catch (error) {
        await context.reply(staffError(error));
      }
    });
  }
  bot.command('report', async (context) => {
    if (roles.get(actor(context)) === 'master') {
      await context.reply('Нет доступа.');
      return;
    }
    const { activity, leadMetrics } = await staff.report(new Date(Date.now() - 7 * 86_400_000));
    const lines = [
      'Заявки за 7 дней по дате создания',
      'Источник / код: всего · квалиф. · назнач. · выполн. · оплач. · BYN',
      ...leadMetrics.map((row) => `${row.source}/${row.code || '—'}: ${row.total} · ${row.qualified} · ${row.assigned} · ${row.completed} · ${row.paid} · ${row.revenue}`),
      'Действия в клиентском боте: запуск / согласие и начало',
      ...activity.map((row) => `${row.code || '—'}: ${row.kind === 'started' ? 'запуск' : 'начало'} · ${row.total}`),
    ];
    await context.reply(guardTelegramText(lines.join('\n')));
  });
  bot.command('delivery', async (context) => {
    try {
      const report = await staff.delivery(actor(context));
      const summary = (rows: { status: string; total: number }[]) => rows.map((row) => `${row.status} ${row.total}`).join(', ') || 'нет задач';
      await context.reply([
        `Корпоративные карточки: ${summary(report.staff)}`,
        `Публичные ответы: ${summary(report.publicReplies)}`,
        `Входящие корпоративные: ${summary(report.incoming.filter((row) => row.source === 'telegram_staff'))}`,
        `Входящие публичные: ${summary(report.incoming.filter((row) => row.source === 'telegram_public'))}`,
      ].join('\n'));
    } catch (error) {
      await context.reply(staffError(error));
    }
  });
}

export function staffError(error: unknown) {
  if (error instanceof LeadAccessError || error instanceof LeadNotFoundError) return 'Заявка недоступна.';
  if (error instanceof LeadValidationError) return error.message;
  throw error;
}
