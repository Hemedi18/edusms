import 'package:flutter/material.dart';

import '../theme/app_theme.dart';

/// Elevated Material 3 card with subtle accent border and reduced-motion respect.
class GlowCard extends StatelessWidget {
  const GlowCard({
    super.key,
    required this.child,
    this.padding = const EdgeInsets.all(16),
    this.accentColor,
    this.onTap,
  });

  final Widget child;
  final EdgeInsetsGeometry padding;
  final Color? accentColor;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    final isDark = theme.brightness == Brightness.dark;
    final disableAnimations = MediaQuery.disableAnimationsOf(context);
    final borderAccent = accentColor != null
        ? accentColor!.withValues(alpha: isDark ? 0.45 : 0.35)
        : (isDark ? AppTheme.darkBorder : AppTheme.lightBorder);

    final decoration = BoxDecoration(
      color: theme.cardTheme.color ?? theme.colorScheme.surface,
      borderRadius: BorderRadius.circular(16),
      border: Border.all(color: borderAccent),
      boxShadow: accentColor != null && isDark
          ? [
              BoxShadow(
                color: accentColor!.withValues(alpha: 0.10),
                blurRadius: 18,
                offset: const Offset(0, 6),
              ),
            ]
          : null,
    );

    final content = Padding(
      padding: padding,
      child: child,
    );

    return AnimatedContainer(
      duration: disableAnimations ? Duration.zero : const Duration(milliseconds: 180),
      decoration: decoration,
      child: Material(
        type: MaterialType.transparency,
        child: onTap != null
            ? InkWell(
                borderRadius: BorderRadius.circular(16),
                onTap: onTap,
                child: content,
              )
            : content,
      ),
    );
  }
}
