export const sampleSessionLines = [
  JSON.stringify({
    type: "user",
    timestamp: "2026-04-18T18:12:09.620Z",
  }),
  JSON.stringify({
    type: "assistant",
    timestamp: "2026-04-18T18:12:11.000Z",
    message: {
      usage: {
        input_tokens: 10,
        output_tokens: 20,
        cache_read_input_tokens: 5,
        cache_creation_input_tokens: 7,
      },
    },
  }),
];
