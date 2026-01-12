
async function testSingleName() {
    const url = 'http://127.0.0.1:3001/api/prospects';
    const payload = {
        firstName: 'Shane',
        email: 'shane.single.fetch.ipv4@test.com',
        leadSource: 'website',
        // lastName omitted, imitating frontend behavior for single name
    };

    try {
        console.log('Sending payload:', payload);
        const res = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });

        const data = await res.json();

        if (res.ok) {
            console.log('Success:', data);
        } else {
            console.error('Error status:', res.status);
            console.error('Error data:', JSON.stringify(data, null, 2));
        }

    } catch (err) {
        console.error('Error:', err.message);
    }
}

testSingleName();
