import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../features/auth/auth_controller.dart';
import '../../features/auth/forgot_password_screen.dart';
import '../../features/auth/login_screen.dart';
import '../../features/auth/register_screen.dart';
import '../../features/automation/automation_screen.dart';
import '../../features/campaigns/campaigns_screen.dart';
import '../../features/contacts/contacts_screen.dart';
import '../../features/dashboard/dashboard_screen.dart';
import '../../features/developers/developer_tools_screen.dart';
import '../../features/devices/devices_screen.dart';
import '../../features/messages/compose_sms_screen.dart';
import '../../features/messages/messages_screen.dart';
import '../../features/notifications/notifications_screen.dart';
import '../../features/onboarding/onboarding_screen.dart';
import '../../features/settings/settings_screen.dart';
import '../../features/shell/hub_more_screen.dart';
import '../../features/shell/main_shell_screen.dart';
import '../../features/simulation/simulation_lab_screen.dart';

final goRouterProvider = Provider<GoRouter>((ref) {
  final authNotifier = ref.read(authControllerProvider.notifier);

  final router = GoRouter(
    initialLocation: '/home',
    refreshListenable: authNotifier.routerRefreshTick,
    redirect: (context, state) {
      final authState = ref.read(authControllerProvider);
      final loc = state.matchedLocation;

      if (authState.isInitializing) {
        return loc == '/splash' ? null : '/splash';
      }

      if (!authState.onboardingSeen && !authState.isAuthenticated) {
        return loc == '/onboarding' ? null : '/onboarding';
      }

      final isPublicRoute = loc == '/login' ||
          loc == '/register' ||
          loc == '/forgot-password' ||
          loc == '/onboarding';

      if (!authState.isAuthenticated) {
        if (loc == '/splash') return '/login';
        return isPublicRoute ? null : '/login';
      }

      if (loc == '/splash' ||
          loc == '/login' ||
          loc == '/register' ||
          loc == '/forgot-password') {
        return '/home';
      }

      return null;
    },
    routes: [
      GoRoute(
        path: '/splash',
        builder: (context, state) => const Scaffold(
          body: Center(
            child: CircularProgressIndicator(),
          ),
        ),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      GoRoute(
        path: '/login',
        builder: (context, state) => const LoginScreen(),
      ),
      GoRoute(
        path: '/register',
        builder: (context, state) => const RegisterScreen(),
      ),
      GoRoute(
        path: '/forgot-password',
        builder: (context, state) => const ForgotPasswordScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return MainShellScreen(navigationShell: navigationShell);
        },
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) => const DashboardScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/messages',
                builder: (context, state) => const MessagesScreen(),
                routes: [
                  GoRoute(
                    path: 'compose',
                    builder: (context, state) => const ComposeSmsScreen(),
                  ),
                ],
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/automation',
                builder: (context, state) => const AutomationScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/campaigns',
                builder: (context, state) => const CampaignsScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/devices',
                builder: (context, state) => const DevicesScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/hub',
                builder: (context, state) => const HubMoreScreen(),
                routes: [
                  GoRoute(
                    path: 'contacts',
                    builder: (context, state) => const ContactsScreen(),
                  ),
                  GoRoute(
                    path: 'simulation',
                    builder: (context, state) => const SimulationLabScreen(),
                  ),
                  GoRoute(
                    path: 'developers',
                    builder: (context, state) => const DeveloperToolsScreen(),
                  ),
                  GoRoute(
                    path: 'notifications',
                    builder: (context, state) => const NotificationsScreen(),
                  ),
                  GoRoute(
                    path: 'settings',
                    builder: (context, state) => const SettingsScreen(),
                  ),
                ],
              ),
            ],
          ),
        ],
      ),
    ],
  );

  ref.onDispose(router.dispose);
  return router;
});
