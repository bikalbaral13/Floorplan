import React, { useEffect, useState, FormEvent, ChangeEvent } from "react";
import { useNavigate, Navigate } from "react-router-dom";
import { Card, CardContent } from "@/components/ui/card"; // ShadCN Card
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";


interface RememberedUser {
    email: string;
    password: string;
}
const API_URL = import.meta.env.VITE_API_URL;

const SignIn: React.FC = () => {
    const navigate = useNavigate();

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [type, setType] = useState<"Customer" | "Employee">("Customer");
    const [showPassword, setShowPassword] = useState(false);
    const [rememberMe, setRememberMe] = useState(false);
    const [emailError, setEmailError] = useState(false);
    const [emailErrorMessage, setEmailErrorMessage] = useState("");
    const [passwordError, setPasswordError] = useState(false);
    const [passwordErrorMessage, setPasswordErrorMessage] = useState("");
    const [suggestions, setSuggestions] = useState<string[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [open, setOpen] = useState(false);

    const [isLoggedIn, setIsLoggedIn] = useState(false);

    useEffect(() => {
        const rememberedUsers: RememberedUser[] =
            JSON.parse(localStorage.getItem("rememberedUsers") || "[]");

        if (rememberedUsers.length > 0) {
            setSuggestions(rememberedUsers.map((user) => user.email));
            const lastUser = rememberedUsers[rememberedUsers.length - 1];
            if (lastUser) {
                setEmail(lastUser.email);
                setPassword(lastUser.password);
                setRememberMe(true);
            }
        }
    }, []);

    const handleClickShowPassword = () => setShowPassword((prev) => !prev);

    const handleCheckboxChange = (checked: boolean) => setRememberMe(checked);

    const handleEmailChange = (e: ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        setEmailError(false);
        setEmailErrorMessage("");
        if (
            e.target.value &&
            suggestions.some((s) => s.toLowerCase().includes(e.target.value.toLowerCase()))
        ) {
            setShowSuggestions(true);
        } else {
            setShowSuggestions(false);
        }
    };

    const handleEmailSelect = (selectedEmail: string) => {
        const rememberedUsers: RememberedUser[] =
            JSON.parse(localStorage.getItem("rememberedUsers") || "[]");
        const selectedUser = rememberedUsers.find((user) => user.email === selectedEmail);
        if (selectedUser) {
            setEmail(selectedUser.email);
            setPassword(selectedUser.password);
            setRememberMe(true);
        }
        setShowSuggestions(false);
    };

    const handlePasswordChange = (e: ChangeEvent<HTMLInputElement>) => {
        setPassword(e.target.value);
        setPasswordError(false);
        setPasswordErrorMessage("");
    };

    const validateInputs = (): boolean => {
        let isValid = true;
        if (!email || !/\S+@\S+\.\S+/.test(email)) {
            setEmailError(true);
            setEmailErrorMessage("Please enter a valid email address.");
            isValid = false;
        }
        if (!password || password.length < 6) {
            setPasswordError(true);
            setPasswordErrorMessage("Password must be at least 6 characters long.");
            isValid = false;
        }
        return isValid;
    };

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        if (!validateInputs()) return;

        try {
            // Example API endpoint
            const response = await fetch(`${API_URL}/api/${type.toLowerCase()}/login`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ email, password }),
            });

            if (!response.ok) {
                console.log("added: ", response)
                throw new Error("Login failed")};

            const data = await response.json();
            localStorage.setItem("token", data.token);
            setIsLoggedIn(true);

            // Handle "remember me"
            const rememberedUsers: RememberedUser[] =
                JSON.parse(localStorage.getItem("rememberedUsers") || "[]");
            if (rememberMe) {
                const filtered = rememberedUsers.filter((user) => user.email !== email);
                const updated = [...filtered, { email, password }].slice(-5);
                localStorage.setItem("rememberedUsers", JSON.stringify(updated));
            } else {
                const filtered = rememberedUsers.filter((user) => user.email !== email);
                localStorage.setItem("rememberedUsers", JSON.stringify(filtered));
            }

            // toast.success("Logged in successfully");
            navigate("/");
        } catch (error) {
            console.error(error);
            setPasswordError(true);
            setPasswordErrorMessage("Invalid email or password");
            // toast.error("Login failed");
        }
    };

    if (isLoggedIn) return <Navigate to="/" />;

    return (
        <div className="flex justify-center items-center min-h-screen p-4 bg-gray-50">
            <Card className="max-w-md w-full p-6 space-y-4">
                <h1 className="text-center text-2xl font-semibold">Welcome Back</h1>

                {/* Admin/Employee Toggle */}
                <RadioGroup value={type} onValueChange={(val) => setType(val as "Customer" | "Employee")} className="flex justify-center space-x-4">
                    <Label>
                        <RadioGroupItem value="Customer" />
                        Admin
                    </Label>
                    <Label>
                        <RadioGroupItem value="Employee" />
                        Employee
                    </Label>
                </RadioGroup>

                <form onSubmit={handleSubmit} className="flex flex-col gap-4 mt-4">
                    <div className="relative">
                        <Label htmlFor="email">Email ID</Label>
                        <Input
                            id="email"
                            type="email"
                            value={email}
                            placeholder="your@email.com"
                            onChange={handleEmailChange}
                            onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                            required
                        />
                        {emailError && <p className="text-red-500 text-sm">{emailErrorMessage}</p>}
                        {showSuggestions && (
                            <div className="absolute top-full left-0 right-0 bg-white border rounded shadow overflow-y-auto max-h-40 z-50">
                                {suggestions
                                    .filter((s) => s.toLowerCase().includes(email.toLowerCase()))
                                    .map((s, i) => (
                                        <div key={i} className="p-2 hover:bg-gray-100 cursor-pointer" onClick={() => handleEmailSelect(s)}>
                                            {s}
                                        </div>
                                    ))}
                            </div>
                        )}
                    </div>

                    <div>
                        <Label htmlFor="password">Password</Label>
                        <Input
                            id="password"
                            type={showPassword ? "text" : "password"}
                            value={password}
                            placeholder="••••••"
                            onChange={handlePasswordChange}
                            required
                        />
                        <button type="button" onClick={handleClickShowPassword} className="text-sm text-blue-500 mt-1">
                            {showPassword ? "Hide" : "Show"}
                        </button>
                        {passwordError && <p className="text-red-500 text-sm">{passwordErrorMessage}</p>}
                    </div>

                    <div className="flex items-center space-x-2">
                        <Checkbox checked={rememberMe} onCheckedChange={handleCheckboxChange} />
                        <span>Remember me</span>
                    </div>

                    <Button type="submit" className="w-full">
                        Sign in
                    </Button>
                </form>

                {/* <div className="flex justify-center mt-2">
                    <Button variant="link" onClick={() => setOpen(true)} className="text-red-500">
                        Forgot your password?
                    </Button>
                </div> */}

            </Card>
        </div>
    );
};

export default SignIn;
