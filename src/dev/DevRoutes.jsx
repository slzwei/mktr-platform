import { Routes, Route } from 'react-router-dom';
import ApiTest from './ApiTest';
import AuthTest from './AuthTest';

export default function DevRoutes() {
    return (
        <Routes>
            <Route path="ApiTest" element={<ApiTest />} />
            <Route path="AuthTest" element={<AuthTest />} />
        </Routes>
    );
}
