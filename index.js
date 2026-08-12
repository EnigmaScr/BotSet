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

   
        const customFields = order.custom_fields || order.properties || order.fields || order.field_values || payload.custom_fields || [];
        let discordId = null;

        if (Array.isArray(customFields)) {
            const foundField = customFields.find(f => {
                const name = (f.name || f.key || f.id || '').toLowerCase();
                return name.includes('discord') || name.includes('id');
            });
            discordId = foundField ? (foundField.value || foundField.val) : null;
        } else if (customFields && typeof customFields === 'object') {
            for (const [key, value] of Object.entries(customFields)) {
                if (key.toLowerCase().includes('discord') || key.toLowerCase().includes('id')) {
                    discordId = value;
                    break;
                }
            }
        }

        // Если поле не найдено через списки, проверяем прямые свойства объекта заказа
        if (!discordId) {
            discordId = order.discord_id || order.discordId || order.custom_field_discord_id;
        }

        console.log('Извлеченный Discord ID:', discordId);

        // Извлекаем ключ товара или информацию о доставке
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
                const cleanId = String(discordId).trim();
                const user = await client.users.fetch(cleanId);
                await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\``);
                console.log(`Ключ успешно отправлен в ЛС пользователю с Discord ID: ${cleanId}`);
            } catch (dmError) {
                console.error('Не удалось отправить личное сообщение (возможно, у пользователя закрыты ЛС или неверный ID):', dmError);
            }
        } else {
            console.log('В заказе не найден Discord ID покупателя.');
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
