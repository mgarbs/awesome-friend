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
const dayOfWeek = new Date().toLocaleDateString('en-US', { weekday: 'long' });

async function sendTextMessage(to, body) {
    const cleanedBody = body.replace(/"/g, '');
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

// Function to generate messages for a chunk of contacts
async function generateMessagesForChunk(contactsChunk) {
    let prompt = `Create a personalized good morning message in the tone of the late Terry Davis 
    for each person that reflects on a spiritual fruit but don't be too profound or corny just keep 
    it simple. Mention that it is ${dayOfWeek}. Each message should be in a new paragraph with the format 
    "To [Name]: [Message]".\n`;

    for (const [name, info] of Object.entries(contactsChunk)) {
        prompt += `To ${name}, my ${info.relationship}, who enjoys ${info.interests}. 
        ${info.note ? 'Note: ' + info.note : 'No specific note'}.\n`;
    }

    try {
        const response = await openai.chat.completions.create({
            model: 'gpt-4-1106-preview',
            messages: [{ role: 'user', content: prompt }],
            max_tokens: 70 * Object.keys(contactsChunk).length
        });

        const generatedMessages = response.choices[0].message.content
                                    .trim().split('\n')
                                    .filter(line => line.startsWith('To '));
        let messages = {};

        generatedMessages.forEach(message => {
            const match = message.match(/^To (\w+): (.*)$/);
            if (match && match.length === 3) {
                const name = match[1];
                const msg = match[2];
                if (name in contactsChunk) {
                    messages[name] = msg;
                }
            }
        });

        return messages;
    } catch (error) {
        console.error(`Error generating messages for chunk: ${error}`);
        throw error;
    }
}

// Function to process contacts in chunks
async function processContactsInChunks(contacts) {
    const chunkSize = 20;
    let messages = {};

    for (let i = 0; i < Object.keys(contacts).length; i += chunkSize) {
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
