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
        console.log('--- ПОЛНЫЙ ВЕБХУК ОТ SELLIX ---');
        console.log(JSON.stringify(payload, null, 2));
        console.log('--------------------------------');

        const webhookOrder = payload.data?.order || payload.data || payload;
        const eventType = payload.event || webhookOrder.event;

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

            // Ищем любые 17-20 значные цифры (Discord ID) во всем теле запроса
            const rawString = JSON.stringify(payload);
            const matches = rawString.match(/\b\d{17,20}\b/g);
            
            if (matches && matches.length > 0) {
                // Берем первое попавшееся похожее число (или исключаем системные id)
                discordId = matches.find(id => id !== webhookOrder.uuid && id !== String(webhookOrder.product_id));
            }

            console.log('Найденный Discord ID:', discordId);

            // Извлечение ключа товара
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

            if (discordId) {
                try {
                    const cleanId = String(discordId).trim();
                    const user = await client.users.fetch(cleanId);
                    await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\``);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с ID: ${cleanId}`);
                } catch (dmError) {
                    console.error('Ошибка отправки ЛС (закрыты личные сообщения или неверный ID):', dmError.message);
                }
            } else {
                console.log('⚠️ Discord ID в теле вебхука не обнаружен.');
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
