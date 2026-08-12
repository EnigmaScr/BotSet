const { Client, GatewayIntentBits } = require('discord.js');
const express = require('express');
const mongoose = require('mongoose');
require('dotenv').config();

const app = express();
app.use(express.json());

// 1. Подключение к базе данных MongoDB
if (!process.env.MONGODB_URI) {
    console.error('КРИТИЧЕСКАЯ ОШИБКА: Не указан MONGODB_URI в переменных окружения.');
    process.exit(1);
}

mongoose.connect(process.env.MONGODB_URI)
    .then(() => console.log('Успешное подключение к базе данных MongoDB'))
    .catch(err => console.error('Ошибка подключения к MongoDB:', err));

// 2. Создание схемы базы данных для ключей
const keySchema = new mongoose.Schema({
    licenseKey: { type: String, required: true, unique: true },
    discordId: { type: String, required: true },
    orderUuid: { type: String, required: true },
    createdAt: { type: Date, default: Date.now },
    expiresAt: { type: Date, required: true }
});

const KeyModel = mongoose.model('LicenseKey', keySchema);

// 3. Инициализация Discord бота
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.DirectMessages
    ]
});

client.once('clientReady', () => {
    console.log(`Бот успешно запущен и вошел в систему как ${client.user.tag}`);
});

// Кэш для блокировки дублирующихся вебхуков от Sellix
const processedOrders = new Set();

// Функция генерации ключа
function generateLicenseKey(orderUuid) {
    const cleanUuid = orderUuid ? orderUuid.replace(/-/g, '').toUpperCase() : Math.random().toString(36).substring(2).toUpperCase();
    return `LUMB-${cleanUuid.substring(0, 4)}-${cleanUuid.substring(4, 8)}-${cleanUuid.substring(8, 12)}`;
}

// 4. Обработчик вебхуков Sellix
app.post('/webhook', async (req, res) => {
    try {
        const payload = req.body;
        const webhookOrder = payload.data?.order || payload.data || payload;
        const eventType = payload.event || webhookOrder.event;
        const orderUuid = webhookOrder.uuid || webhookOrder.id;

        // Защита от дублей: если заказ уже обрабатывался в последние 10 минут, игнорируем
        if (orderUuid && processedOrders.has(orderUuid)) {
            console.log(`Дубликат вебхука для заказа ${orderUuid} проигнорирован.`);
            return res.status(200).json({ success: true, message: 'Already processed' });
        }

        if (
            eventType === 'order:paid' || 
            eventType === 'order.paid' || 
            webhookOrder.status === 'COMPLETED' || 
            webhookOrder.status === 'delivering' || 
            webhookOrder.status === 'paid' ||
            payload.status === true
        ) {
            // Добавляем заказ в кэш обработанных
            if (orderUuid) {
                processedOrders.add(orderUuid);
                setTimeout(() => processedOrders.delete(orderUuid), 600000); // Очистка кэша через 10 минут
            }

            let discordId = null;

            // Достаем Discord ID из поля customer_email
            const emailField = String(webhookOrder.customer_email || '');
            const match = emailField.match(/\b\d{17,20}\b/);
            if (match) {
                discordId = match[0];
            }

            // Формируем ключ
            let licenseKey = null;
            const productSerials = webhookOrder.serials || webhookOrder.product_sent || webhookOrder.product_downloads || [];
            
            if (Array.isArray(productSerials) && productSerials.length > 0) {
                licenseKey = typeof productSerials[0] === 'string' ? productSerials[0] : productSerials[0].product_name;
            } else if (typeof productSerials === 'string' && productSerials.trim() !== '') {
                licenseKey = productSerials;
            }

            if (!licenseKey || licenseKey === 'LumbKey 30 d') {
                licenseKey = generateLicenseKey(orderUuid);
            }

            // Сохраняем ключ в базу данных на 30 дней
            const expirationDate = new Date();
            expirationDate.setDate(expirationDate.getDate() + 30);

            try {
                const newKeyRecord = new KeyModel({
                    licenseKey: licenseKey,
                    discordId: discordId || 'Unknown',
                    orderUuid: orderUuid || 'Unknown',
                    expiresAt: expirationDate
                });
                await newKeyRecord.save();
                console.log(`Ключ ${licenseKey} успешно сохранен в базу до ${expirationDate.toISOString()}`);
            } catch (dbError) {
                console.error('Ошибка при сохранении ключа в БД (возможно дубликат):', dbError.message);
            }

            // Отправка ключа пользователю в ЛС
            if (discordId) {
                try {
                    const cleanId = String(discordId).trim();
                    const user = await client.users.fetch(cleanId);
                    await user.send(`Спасибо за покупку в магазине!\nВаш лицензионный ключ: \`${licenseKey}\`\nОн будет активен в течение 30 дней.`);
                    console.log(`Ключ успешно отправлен в ЛС пользователю с ID: ${cleanId}`);
                } catch (dmError) {
                    console.error('Ошибка отправки ЛС:', dmError.message);
                }
            }
        }

        res.status(200).json({ success: true });
    } catch (error) {
        console.error('Ошибка при обработке вебхука:', error);
        res.status(500).json({ error: 'Internal Server Error' });
    }
});

// 5. API Эндпоинт для твоего скрипта (Проверка ключа)
app.get('/validate', async (req, res) => {
    try {
        const providedKey = req.query.key;
        
        if (!providedKey) {
            return res.status(400).json({ valid: false, message: 'Ключ не предоставлен' });
        }

        // Ищем ключ в базе данных
        const keyData = await KeyModel.findOne({ licenseKey: providedKey });

        if (!keyData) {
            return res.status(404).json({ valid: false, message: 'Ключ не существует' });
        }

        // Проверяем срок действия (30 дней)
        const currentDate = new Date();
        if (currentDate > keyData.expiresAt) {
            return res.status(403).json({ valid: false, message: 'Срок действия ключа истек' });
        }

        // Рассчитываем оставшееся время
        const daysLeft = Math.ceil((keyData.expiresAt - currentDate) / (1000 * 60 * 60 * 24));

        // Возвращаем успешный ответ твоему скрипту
        return res.status(200).json({ 
            valid: true, 
            discordId: keyData.discordId,
            daysLeft: daysLeft,
            message: 'Ключ действителен'
        });

    } catch (error) {
        console.error('Ошибка при валидации ключа:', error);
        res.status(500).json({ valid: false, message: 'Ошибка сервера при проверке ключа' });
    }
});

const PORT = process.env.PORT || 8080;
app.listen(PORT, () => {
    console.log(`Вебхук-сервер запущен и слушает порт ${PORT}`);
});

client.login(process.env.DISCORD_TOKEN);
