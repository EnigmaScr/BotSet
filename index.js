const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const https = require('https');
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

// Функция для надежного запроса к API Sellix через встроенный модуль https (без сбоев fetch)
function fetchSellixOrder(orderUuid) {
    return new Promise((resolve, reject) => {
        const apiKey = process.env.SELLIX_API_KEY ? process.env.SELLIX_API_KEY.trim() : '';
        const merchant = process.env.SELLIX_MERCHANT_NAME ? process.env.SELLIX_MERCHANT_NAME.trim() : '';

        const options = {
            hostname: 'api.sellix.io',
            path: `/v1/orders/${orderUuid}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${apiKey}`,
                'X-Sellix-Merchant': merchant,
                'Accept': 'application/json',
                'User-Agent': 'SellBot-Discord/1.0'
            }
        };

        const req = https.request(options, (res) => {
            let body = '';
            res.on('data', (chunk) => { body += chunk; });
            res.on('end', () => {
                try {
                    const json = JSON.parse(body);
                    resolve(json);
                } catch (e) {
                    reject(new Error(`Ошибка парсинга ответа API: ${body}`));
                }
            });
        });

        req.on('error', (err) => {
            reject(err);
        });

        req.end();
    });
}

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

            // Проверяем поля в самом вебхуке (на случай если появятся)
            let customFields = webhookOrder.custom_fields || webhookOrder.properties || payload.custom_fields || null;

            // Если полей нет, запрашиваем полные данные через API Sellix
            if ((!customFields || Object.keys(customFields).length === 0) && orderUuid && process.env.SELLIX_API_KEY) {
                try {
                    console.log('Делаем запрос к API Sellix для получения полей заказа...');
                    const apiData = await fetchSellixOrder(orderUuid);
                    
                    if (apiData && apiData.data && apiData.data.order) {
                        const order = apiData.data.order;
                        customFields = order.custom_fields || order.properties || null;
                        
                        if (order.serials && order.serials.length > 0) {
                            licenseKey = order.serials[0];
                        } else if (order.product_sent) {
                            licenseKey = order.product_sent;
                        }
                        console.log('Данные из API успешно получены!');
                    } else {
                        console.error('API Sellix вернул странный ответ:', JSON.stringify(apiData));
                    }
                } catch (apiErr) {
                    console.error('Ошибка при запросе к API Sellix:', apiErr.message);
                }
            }

            // Извлекаем Discord ID из кастомных полей
            if (customFields) {
                if (Array.isArray(customFields)) {
                    const foundField = customFields.find(f => {
                        const name = String(f.name || f.key || f.id || '').toLowerCase();
                        return name.includes('discord');
                    });
                    if (foundField) discordId = foundField.value || foundField.val;
                } else if (typeof customFields === 'object') {
                    for (const [key, val] of Object.entries(customFields)) {
                        if (String(key).toLowerCase().includes('discord')) {
                            discordId = typeof val === 'object' ? (val.value || val.val) : val;
                            break;
                        }
                    }
                }
            }

            // Запасной вариант поиска по прямым ключам
            if (!discordId) {
                discordId = webhookOrder.discord_id || webhookOrder.discordId || webhookOrder.custom_field_discord_id;
            }

            console.log('Извлеченный Discord ID:', discordId);

            // Извлекаем серийный ключ из вебхука, если он там был
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

            // Отправка в ЛС пользователю
            if (discordId) {
                try {
                    const cleanId = String(discordId).trim().replace(/[<@!>]/g, '');
                    const user = await client.users.fetch(cleanId);
                    await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\``);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с Discord ID: ${cleanId}`);
                } catch (dmError) {
                    console.error('Не удалось отправить ЛС (закрыты ЛС у юзера или неверный ID):', dmError);
                }
            } else {
                console.log('⚠️ В заказе не найден Discord ID. Убедитесь, что в Sellix заполнено поле мерчанта и ключа.');
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
