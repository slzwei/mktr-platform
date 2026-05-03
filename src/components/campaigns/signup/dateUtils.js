
// Format date input as DD/MM/YYYY
export const formatDateInput = (value) => {
 // Remove all non-digits
 let digits = value.replace(/\D/g, '');

 // Limit to 8 digits (DDMMYYYY)
 digits = digits.slice(0, 8);

 // Add slashes at appropriate positions
 if (digits.length >= 3) {
 digits = digits.slice(0, 2) + '/' + digits.slice(2);
 }
 if (digits.length >= 6) {
 digits = digits.slice(0, 5) + '/' + digits.slice(5);
 }

 return digits;
};

// Calculate age from DD/MM/YYYY format
export const calculateAge = (dateString) => {
 if (!dateString || dateString.length !== 10) return null;

 const [day, month, year] = dateString.split('/').map(Number);
 if (isNaN(day) || isNaN(month) || isNaN(year) || day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
 return null;
 }

 const birthDate = new Date(year, month - 1, day);
 if (birthDate.getDate() !== day || birthDate.getMonth() !== month - 1 || birthDate.getFullYear() !== year) {
 return null;
 }

 const today = new Date();
 let age = today.getFullYear() - birthDate.getFullYear();
 const monthDiff = today.getMonth() - birthDate.getMonth();

 if (monthDiff < 0 || (monthDiff === 0 && today.getDate() < birthDate.getDate())) {
 age--;
 }

 return age;
};

// Validate age against campaign range, returns error string or empty string
export const getAgeValidationError = (dateString, campaign) => {
 if (!campaign) return '';

 const digitsOnly = dateString.replace(/\D/g, '');

 if (digitsOnly.length > 0 && digitsOnly.length !== 8) {
 return 'Please enter full year in DDMMYYYY format';
 }

 if (digitsOnly.length === 0) return '';

 if (digitsOnly.length === 8) {
 const day = parseInt(digitsOnly.slice(0, 2), 10);
 const month = parseInt(digitsOnly.slice(2, 4), 10);
 const year = parseInt(digitsOnly.slice(4, 8), 10);

 if (day < 1 || day > 31 || month < 1 || month > 12 || year < 1900 || year > new Date().getFullYear()) {
 return 'Please enter a valid date';
 }

 const testDate = new Date(year, month - 1, day);
 if (testDate.getDate() !== day || testDate.getMonth() !== month - 1 || testDate.getFullYear() !== year) {
 return 'Please enter a valid date';
 }
 }

 const age = calculateAge(dateString);
 if (age === null) return '';

 const hasMinAge = campaign.min_age !== undefined && campaign.min_age !== null;
 const hasMaxAge = campaign.max_age !== undefined && campaign.max_age !== null;
 const minAge = hasMinAge ? campaign.min_age : 0;
 const maxAge = hasMaxAge ? campaign.max_age : 150;

 if (hasMinAge && age < minAge) {
 return `Must be at least ${minAge} years old`;
 }
 if (hasMaxAge && age > maxAge) {
 return `Only available for ages ${hasMinAge ? `${minAge}-` : ''}${maxAge}`;
 }

 return '';
};

// Get age restriction hint text for display
export const getAgeRestrictionHint = (campaign) => {
 if (!campaign) return null;
 const hasMinAge = campaign.min_age !== undefined && campaign.min_age !== null;
 const hasMaxAge = campaign.max_age !== undefined && campaign.max_age !== null;
 if (!hasMinAge && !hasMaxAge) return null;
 if (hasMinAge && hasMaxAge) return `Only available for ages ${campaign.min_age}-${campaign.max_age}`;
 if (hasMinAge) return `Only available for ages ${campaign.min_age}+`;
 return `Only available for ages up to ${campaign.max_age}`;
};

// Format phone number for display: XXXX XXXX
export const displayPhone = (value) => {
 if (value.length <= 4) return value;
 return `${value.slice(0, 4)} ${value.slice(4)}`;
};
