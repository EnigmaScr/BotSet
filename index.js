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

        // Проверяем структуру события оплаты от Sellix
        const order = payload.data || payload;
        const eventType = payload.event || payload.status;

        if (eventType === 'order:paid' || order.status === 'COMPLETED' || payload.status === true) {
            // Извлекаем кастомное поле с Discord ID, которое покупатель заполнил на сайте
            const customFields = order.custom_fields || {};
            const discordId = customFields['Discord ID'] || customFields['discord_id'] || customFields['Discord'];

            // Извлекаем сгенерированный ключ товара
            const productSerials = order.product_sent || order.serials || order.product_downloads || [];
            const licenseKey = Array.isArray(productSerials) && productSerials.length > 0 
                ? productSerials[0] 
                : (typeof productSerials === 'string' ? productSerials : 'Ключ успешно создан в системе Sellix');

            if (discordId) {
                try {
                    const user = await client.users.fetch(discordId.trim());
                    await user.send(`Спасибо за покупку в магазине Axiom!\nВаш лицензионный ключ: \`${licenseKey}\``);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с Discord ID: ${discordId}`);
                } catch (dmError) {
                    console.error('Не удалось отправить личное сообщение (возможно, у пользователя закрыты ЛС):', dmError);
                }
            } else {
                console.log('В заказе не найден Discord ID покупателя.');
            }
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Ошибка при обработке вебхука:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Вебхук-сервер запущен и слушает порт ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);