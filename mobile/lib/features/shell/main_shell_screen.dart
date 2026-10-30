import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

import '../support/instant_help_sheet.dart';

/// Responsive shell using NavigationBar on phones (< 760px) and NavigationRail on tablets,
/// plus a global Instant Help & AI Support floating button with live screen capture.
class MainShellScreen extends StatefulWidget {
  const MainShellScreen({
    super.key,
    required this.navigationShell,
  });

  final StatefulNavigationShell navigationShell;

  @override
  State<MainShellScreen> createState() => _MainShellScreenState();
}

class _MainShellScreenState extends State<MainShellScreen> {
  final GlobalKey _screenBoundaryKey = GlobalKey();

  void _onDestinationSelected(int index) {
    widget.navigationShell.goBranch(
      index,
      initialLocation: index == widget.navigationShell.currentIndex,
    );
  }

  void _openInstantHelp(BuildContext context) {
    showModalBottomSheet<void>(
      context: context,
      isScrollControlled: true,
      useSafeArea: true,
      builder: (_) => InstantHelpSheet(screenBoundaryKey: _screenBoundaryKey),
    );
  }

  static const _destinations = <({String label, IconData icon, IconData activeIcon})>[
    (
      label: 'Home',
      icon: Icons.dashboard_outlined,
      activeIcon: Icons.dashboard_rounded,
    ),
    (
      label: 'Messages',
      icon: Icons.forum_outlined,
      activeIcon: Icons.forum_rounded,
    ),
    (
      label: 'Automation',
      icon: Icons.auto_awesome_outlined,
      activeIcon: Icons.auto_awesome_rounded,
    ),
    (
      label: 'Campaigns',
      icon: Icons.campaign_outlined,
      activeIcon: Icons.campaign_rounded,
    ),
    (
      label: 'Devices',
      icon: Icons.smartphone_outlined,
      activeIcon: Icons.smartphone_rounded,
    ),
    (
      label: 'More',
      icon: Icons.grid_view_outlined,
      activeIcon: Icons.grid_view_rounded,
    ),
  ];

  @override
  Widget build(BuildContext context) {
    final isWide = MediaQuery.sizeOf(context).width >= 760;

    final helpButton = FloatingActionButton.extended(
      heroTag: 'edusms_instant_help_fab',
      onPressed: () => _openInstantHelp(context),
      icon: const Icon(Icons.support_agent_rounded, size: 18),
      label: const Text('Instant Help & AI'),
    );

    if (isWide) {
      return RepaintBoundary(
        key: _screenBoundaryKey,
        child: Scaffold(
          floatingActionButton: helpButton,
          body: Row(
            children: [
              NavigationRail(
                selectedIndex: widget.navigationShell.currentIndex,
                onDestinationSelected: _onDestinationSelected,
                labelType: NavigationRailLabelType.all,
                destinations: _destinations
                    .map(
                      (d) => NavigationRailDestination(
                        icon: Icon(d.icon),
                        selectedIcon: Icon(d.activeIcon),
                        label: Text(d.label),
                      ),
                    )
                    .toList(),
              ),
              const VerticalDivider(width: 1),
              Expanded(child: widget.navigationShell),
            ],
          ),
        ),
      );
    }

    return RepaintBoundary(
      key: _screenBoundaryKey,
      child: Scaffold(
        floatingActionButton: helpButton,
        body: widget.navigationShell,
        bottomNavigationBar: NavigationBar(
          selectedIndex: widget.navigationShell.currentIndex,
          onDestinationSelected: _onDestinationSelected,
          destinations: _destinations
              .map(
                (d) => NavigationDestination(
                  icon: Icon(d.icon),
                  selectedIcon: Icon(d.activeIcon),
                  label: d.label,
                ),
              )
              .toList(),
        ),
      ),
    );
  }
}
