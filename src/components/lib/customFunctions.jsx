// Dummy OTP functions that simulate the behavior without actual SMS
export const sendOtp = async (phone) => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    console.log('Simulating OTP send to:', phone);
    
    // Always return success
    return {
        data: {
            success: true,
            message: 'Verification code sent successfully'
        }
    };
};

export const verifyOtp = async (phone, otp) => {
    // Simulate API call delay
    await new Promise(resolve => setTimeout(resolve, 500));
    
    console.log('Simulating OTP verification for:', phone, 'with code:', otp);
    
    // Accept any 6-digit code for demo purposes
    if (otp && otp.length === 6) {
        return {
            data: {
                success: true,
                message: 'Phone number verified successfully'
            }
        };
    } else {
        return {
            data: {
                success: false,
                message: 'Invalid verification code'
            }
        };
    }
};