import { BrowserRouter, Route, Routes } from "react-router-dom";
import LoginPage from "./pages/LoginPage";
import HomePage from "./pages/HomePage";
import CreateRoomPage from "./pages/CreateRoomPage";
import JoinRoomPage from "./pages/JoinRoomPage";
import GamePage from "./pages/GamePage";
import { RequireAuth } from "./auth/RequireAuth";

export default function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route
          path="/"
          element={
            <RequireAuth>
              <HomePage />
            </RequireAuth>
          }
        />
        <Route
          path="/create-room"
          element={
            <RequireAuth>
              <CreateRoomPage />
            </RequireAuth>
          }
        />
        <Route
          path="/join-room"
          element={
            <RequireAuth>
              <JoinRoomPage />
            </RequireAuth>
          }
        />
        <Route
          path="/room/:roomId"
          element={
            <RequireAuth>
              <GamePage />
            </RequireAuth>
          }
        />
      </Routes>
    </BrowserRouter>
  );
}

