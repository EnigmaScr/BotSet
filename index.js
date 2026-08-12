const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
require('dotenv').config();

const app = express();
app.use(express.json());

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages
    ]
});

client.once('clientReady', () => {
    console.log(`Бот успешно запущен и вошел в систему как ${client.user.tag}`);
});

app.post('/webhook', async (req, res) => {
    try {
        const payload = req.body;
        console.log('Получен вебхук от Sellix:', JSON.stringify(payload, null, 2));

        const webhookOrder = payload.data?.order || payload.data || payload;
        const eventType = payload.event || webhookOrder.event;

        console.log('Тип события:', eventType);

        if (
            eventType === 'order:paid' || 
            eventType === 'order.paid' || 
            webhookOrder.status === 'COMPLETED' || 
            webhookOrder.status === 'delivering' || 
            webhookOrder.status === 'paid' ||
            payload.status === true
        ) {
            let discordId = null;
            let licenseKey = 'Ключ успешно создан в системе Sellix';

            // Ищем Discord ID во всех возможных структурах вебхука Sellix
            const possibleFields = [
                webhookOrder.custom_fields,
                webhookOrder.properties,
                payload.custom_fields,
                webhookOrder.thank_you_note,
                webhookOrder.feedback
            ];

            for (const fieldBlock of possibleFields) {
                if (!fieldBlock) continue;
                
                if (Array.isArray(fieldBlock)) {
                    const found = fieldBlock.find(f => {
                        const name = String(f.name || f.key || f.id || '').toLowerCase();
                        return name.includes('discord');
                    });
                    if (found) {
                        discordId = found.value || found.val;
                        break;
                    }
                } else if (typeof fieldBlock === 'object') {
                    for (const [key, val] of Object.entries(fieldBlock)) {
                        if (String(key).toLowerCase().includes('discord')) {
                            discordId = typeof val === 'object' ? (val.value || val.val) : val;
                            break;
                        }
                    }
                }
            }

            // Прямые ключи в объекте заказа
            if (!discordId) {
                discordId = webhookOrder.discord_id || 
                            webhookOrder.discordId || 
                            webhookOrder.custom_field_discord_id || 
                            webhookOrder.customer_discord_id ||
                            webhookOrder.fields?.discord_id;
            }

            console.log('Извлеченный Discord ID:', discordId);

            // Извлечение лицензионного ключа / товара
            const productSerials = webhookOrder.serials || webhookOrder.product_sent || webhookOrder.product_downloads || webhookOrder.items || [];
            if (Array.isArray(productSerials) && productSerials.length > 0) {
                if (typeof productSerials[0] === 'string') {
                    licenseKey = productSerials[0];
                } else if (productSerials[0].product_name) {
                    licenseKey = productSerials[0].product_name;
                }
            } else if (typeof productSerials === 'string') {
                licenseKey = productSerials;
            }

            // Отправка сообщения в ЛС пользователю
            if (discordId) {
                try {
                    const cleanId = String(discordId).trim().replace(/[<@!>]/g, '');
                    const user = await client.users.fetch(cleanId);
                    await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\``);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с Discord ID: ${cleanId}`);
                } catch (dmError) {
                    console.error('Не удалось отправить ЛС (закрыты личные сообщения у пользователя или неверный ID):', dmError);
                }
            } else {
                console.log('⚠️ В заказе не найден Discord ID. Убедитесь, что в Sellix в настройках вебхука или кастомного поля передаются данные о покупателе.');
            }
        } else {
            console.log('Событие проигнорировано.');
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Ошибка при обработке вебхука:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Вебхук-сервер запущен и слушает порт ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
