import { exec } from 'child_process';
import fs from 'fs';
import { promisify } from 'util';
import OpenAI from 'openai';
import contacts from './contacts.json' assert { type: 'json' };
import dotenv from 'dotenv';
dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API,
});

const writeFileAsync = promisify(fs.writeFile);
const unlinkAsync = promisify(fs.unlink);
const execAsync = promisify(exec);

// Function to generate messages for a chunk of contacts
async function generateMessagesForChunk(contactsChunk) {
    let prompt = "Create a very short, personalized good morning message without any numbers in it. Each message should be no longer than two sentences and have a tone of gratitude and surrender toward God for the following contacts:\n";

    for (const [name, info] of Object.entries(contactsChunk)) {
        prompt += `- For my ${info.relationship} who likes ${info.interests}, though not necessarily a daily activity. (${info.note ? 'Note: ' + info.note : 'No specific note'})\n`;
    }

    const response = await openai.chat.completions.create({
        model: 'gpt-4-1106-preview',
        messages: [{ role: 'user', content: prompt }],
        max_tokens: 60 * Object.keys(contactsChunk).length
    });

    const generatedMessages = response.choices[0].message.content.trim().split('\n').filter(line => line.trim());
    let messages = {};

    Object.keys(contactsChunk).forEach((name, index) => {
        if (index < generatedMessages.length) {
            messages[name] = generatedMessages[index].replace(/- /g, '');
        }
    });

    return messages;
}

// Function to send text message
async function sendTextMessage(to, body) {
    const cleanedBody = body.replace(/"/g, ''); // Escape double quotes in the message
    const appleScriptContent = `
        tell application "Messages"
            send "${cleanedBody}" to participant "${to}"
        end tell
    `;

    const scriptPath = '/tmp/sendMessage.scpt';

    try {
        await writeFileAsync(scriptPath, appleScriptContent);
        await execAsync(`osascript ${scriptPath}`);
        console.log(`Message sent to ${to}`);
    } catch (error) {
        console.error(`Error sending message to ${to}: ${error}`);
    } finally {
        await unlinkAsync(scriptPath);
    }
}

// Function to process contacts in chunks
async function processContactsInChunks(contacts) {
    const chunkSize = 20;
    let messages = {};

    for (let i = 0; i < contacts.length; i += chunkSize) {
        const chunk = Object.fromEntries(Object.entries(contacts).slice(i, i + chunkSize));
        const chunkMessages = await generateMessagesForChunk(chunk);
        messages = { ...messages, ...chunkMessages };
    }

    return messages;
}

// Main function
async function main() {
    const messages = await processContactsInChunks(contacts);

    for (let [name, message] of Object.entries(messages)) {
        await sendTextMessage(contacts[name].phone, message);
        console.log(`Message sent to ${name}: ${message}`);
    }
}

main().catch(console.error);
