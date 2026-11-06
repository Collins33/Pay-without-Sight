// Stage configuration for the fake demo government service (served by `npm run demo`).

export const DEMO_WORKFLOW = {
  id: 'demo-permit-renewal',
  service: 'Demo permit renewal (fake data)',
  // Matching is by exact origin and path only. Page content can never make a site look like this workflow.
  origins: ['http://localhost:4173', 'http://127.0.0.1:4173'],
  // Display text read from the page for the payment review. Display text only, never form values.
  detailSelectors: {
    recipient: '#pay-recipient',
    amount: '#pay-amount',
    fees: '#pay-fees',
    total: '#pay-total',
    purpose: '#pay-purpose',
  },
  // Text on the review page that is only watched for changes (hashed), so editing it invalidates a confirmation.
  fingerprintSelectors: { reviewSummary: '#summary' },
  receiptSelector: '#receipt',
  prerequisites: { payment: ['submission'] },
  stages: [
    {
      id: 'personal',
      title: 'Personal details',
      path: '/personal.html',
      instruction: 'Fill in your personal details, then say "continue".',
      explain: 'This step asks for your full name, national ID number, phone number and date of birth. The date is split into day, month and year fields.',
    },
    {
      id: 'service',
      title: 'Service information',
      path: '/service.html',
      instruction: 'Choose the service, enter your permit number, pick how to collect it, and tick the declaration.',
      explain: 'This step asks which service you want, your existing permit number, how you will collect the permit, and a declaration that your information is true.',
    },
    {
      id: 'review',
      title: 'Review and submit',
      path: '/review.html',
      consequential: 'submission',
      instruction: 'Review the summary, enter your verification code, then confirm the submission in the panel.',
      readyInstruction: 'Everything required is filled in. Review the summary, then confirm the submission in the panel.',
      submissionDescription: 'Your permit renewal application, using the details shown in the summary on the review page and the verification code you type yourself.',
      explain: 'This step shows a summary of your application and asks for the verification code sent to your phone. Submitting is a consequential action: I will only help after you confirm it in the panel.',
    },
    {
      id: 'payment',
      title: 'Payment',
      path: '/payment.html',
      consequential: 'payment',
      instruction: 'Check the recipient, amount, fees and total, type your card details yourself, then confirm the payment in the panel.',
      readyInstruction: 'Check the payment summary, type your card details yourself, then confirm the payment in the panel.',
      explain: 'This step shows who you are paying and how much, and asks for card details. This is a simulated payment. Paying is a consequential action that needs your separate confirmation in the panel.',
    },
    {
      id: 'receipt',
      title: 'Receipt',
      path: '/receipt.html',
      instruction: 'Say "read receipt" to hear your simulated receipt.',
      explain: 'This step shows your simulated receipt with a receipt number, who was paid, the amount and the date.',
    },
  ],
};
