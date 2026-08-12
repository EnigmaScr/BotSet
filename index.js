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

   
        const order = payload.data?.order || payload.data || payload;
        const eventType = payload.event || order.event;

        console.log('Тип события:', eventType, 'Статус заказа:', order.status);

   
        if (
            eventType === 'order:paid' || 
            eventType === 'order.paid' || 
            order.status === 'COMPLETED' || 
            order.status === 'delivering' || 
            order.status === 'paid' ||
            payload.status === true
        ) {
            // Sellix передает кастомные поля в виде массива
            const customFields = order.custom_fields;
            let discordId = null;

            if (Array.isArray(customFields)) {
                const foundField = customFields.find(f => 
                    f.name === 'Discord ID' || f.name === 'discord_id' || f.name === 'Discord'
                );
                discordId = foundField ? foundField.value : null;
            } else if (customFields && typeof customFields === 'object') {
                discordId = customFields['Discord ID'] || customFields['discord_id'] || customFields['Discord'];
            }

            console.log('Извлеченный Discord ID:', discordId);

      
            const productSerials = order.product_sent || order.serials || order.product_downloads || order.items || [];
            let licenseKey = 'Ключ успешно создан в системе Sellix';
            
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
                    const user = await client.users.fetch(discordId.trim());
                    await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\``);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с Discord ID: ${discordId}`);
                } catch (dmError) {
                    console.error('Не удалось отправить личное сообщение (возможно, у пользователя закрыты ЛС или неверный ID):', dmError);
                }
            } else {
                console.log('В заказе не найден Discord ID покупателя.');
            }
        } else {
            console.log('Событие проигнорировано (не подпадает под условия отправки).');
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
