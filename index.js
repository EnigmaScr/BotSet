const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const dns = require('dns');
require('dotenv').config();

if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

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

            let customFields = webhookOrder.custom_fields || webhookOrder.properties || payload.custom_fields || null;

            // Запрос к API Sellix с добавлением обязательного заголовка магазина
            if ((!customFields || Object.keys(customFields).length === 0) && orderUuid && process.env.SELLIX_API_KEY) {
                try {
                    console.log('Делаем запрос к API Sellix для получения полей заказа...');
                    
                    const headers = {
                        'Authorization': `Bearer ${process.env.SELLIX_API_KEY.trim()}`,
                        'User-Agent': 'SellBot-Discord/1.0',
                        'Accept': 'application/json'
                    };

                    // Если указано имя мерчанта, добавляем его в заголовок
                    if (process.env.SELLIX_MERCHANT_NAME) {
                        headers['X-Sellix-Merchant'] = process.env.SELLIX_MERCHANT_NAME.trim();
                    }

                    const apiResponse = await fetch(`https://api.sellix.io/v1/orders/${orderUuid}`, {
                        method: 'GET',
                        headers: headers
                    });

                    const responseText = await apiResponse.text();
                    
                    if (apiResponse.ok) {
                        const apiData = JSON.parse(responseText);
                        if (apiData?.data?.order) {
                            const order = apiData.data.order;
                            customFields = order.custom_fields || order.properties || customFields;
                            
                            if (order.serials && order.serials.length > 0) {
                                licenseKey = order.serials[0];
                            } else if (order.product_sent) {
                                licenseKey = order.product_sent;
                            }
                        }
                    } else {
                        console.error(`Ошибка ответа API Sellix [${apiResponse.status}]:`, responseText);
                    }
                } catch (apiErr) {
                    console.error('Ошибка сети при запросе к API Sellix:', apiErr.message);
                }
            }

            // Поиск Discord ID в кастомных полях
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

            if (!discordId) {
                discordId = webhookOrder.discord_id || webhookOrder.discordId || webhookOrder.custom_field_discord_id || webhookOrder.customer_discord_id;
            }

            console.log('Извлеченный Discord ID:', discordId);

            // Серийный ключ
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

            // Отправка сообщения в ЛС
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
                console.log('В заказе не найден Discord ID покупателя. Проверьте настройки Custom Fields товара в Sellix.');
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
