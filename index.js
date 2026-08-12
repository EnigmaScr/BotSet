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

client.once('ready', () => {
    console.log(`Бот успешно запущен и вошел в систему как ${client.user.tag}`);
});

app.post('/webhook', async (req, res) => {
    try {
        const payload = req.body;
        console.log('Получен вебхук от Sellix:', JSON.stringify(payload, null, 2));

        const webhookOrder = payload.data?.order || payload.data || payload;
        const eventType = payload.event || webhookOrder.event;
        const orderUuid = webhookOrder.uuid || webhookOrder.id;

        console.log('Тип события:', eventType, 'UUID заказа:', orderUuid);

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

            // Пробуем найти кастомные поля прямо в вебхуке (если они там появятся)
            let customFields = webhookOrder.custom_fields || webhookOrder.properties || [];
            
            // Если в вебхуке полей нет, но есть API-ключ и UUID, запрашиваем полные данные через API Sellix
            if ((!customFields || customFields.length === 0) && orderUuid && process.env.SELLIX_API_KEY) {
                try {
                    console.log('Делаем запрос к API Sellix для получения полей заказа...');
                    const apiResponse = await fetch(`https://dev.sellix.io/v1/orders/${orderUuid}`, {
                        headers: {
                            'Authorization': `Bearer ${process.env.SELLIX_API_KEY}`
                        }
                    });
                    const apiData = await apiResponse.json();
                    if (apiData && apiData.data && apiData.data.order) {
                        customFields = apiData.data.order.custom_fields || apiData.data.order.properties || [];
                        if (apiData.data.order.product_sent) {
                            licenseKey = apiData.data.order.product_sent;
                        }
                    }
                } catch (apiErr) {
                    console.error('Ошибка при запросе к API Sellix:', apiErr);
                }
            }

            // Извлекаем Discord ID из массива полей
            if (Array.isArray(customFields)) {
                const foundField = customFields.find(f => {
                    const name = (f.name || f.key || f.id || '').toLowerCase();
                    return name.includes('discord');
                });
                discordId = foundField ? (foundField.value || foundField.val) : null;
            }

            // Если не нашли через массив, проверяем ключи вебхука напрямую
            if (!discordId) {
                discordId = webhookOrder.discord_id || webhookOrder.discordId || webhookOrder.custom_field_discord_id;
            }

            console.log('Извлеченный Discord ID:', discordId);

            // Извлекаем ключи товара, если они переданы в вебхуке
            const productSerials = webhookOrder.product_sent || webhookOrder.serials || webhookOrder.product_downloads || webhookOrder.items || [];
            if (Array.isArray(productSerials) && productSerials.length > 0) {
                if (typeof productSerials[0] === 'string') {
                    licenseKey = productSerials[0];
                } else if (productSerials[0].product_name) {
                    licenseKey = productSerials[0].product_name;
                }
            } else if (typeof productSerials === 'string') {
                licenseKey = productSerials;
            }

            if (discordId) {
                try {
                    const cleanId = String(discordId).trim();
                    const user = await client.users.fetch(cleanId);
                    await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\``);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с Discord ID: ${cleanId}`);
                } catch (dmError) {
                    console.error('Не удалось отправить личное сообщение (возможно, закрыты ЛС или неверный ID):', dmError);
                }
            } else {
                console.log('В заказе не найден Discord ID покупателя.');
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
