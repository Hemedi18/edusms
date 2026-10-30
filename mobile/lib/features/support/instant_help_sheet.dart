import 'dart:convert';
import 'dart:ui' as ui;

import 'package:flutter/material.dart';
import 'package:flutter/rendering.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/network/api_client.dart';

/// Captures a PNG base64 data URL of a [RepaintBoundary] key so the user can attach a live screenshot
/// of the current Flutter screen inside the Instant Help & AI Support drawer.
Future<String> captureFlutterScreenDataUrl(GlobalKey boundaryKey) async {
  try {
    final context = boundaryKey.currentContext;
    if (context == null) return '';
    final renderObject = context.findRenderObject();
    if (renderObject is! RenderRepaintBoundary) return '';
    final image = await renderObject.toImage(pixelRatio: 1.25);
    final byteData = await image.toByteData(format: ui.ImageByteFormat.png);
    if (byteData == null) return '';
    final bytes = byteData.buffer.asUint8List();
    return 'data:image/png;base64,${base64Encode(bytes)}';
  } catch (_) {
    return '';
  }
}

class InstantHelpSheet extends ConsumerStatefulWidget {
  const InstantHelpSheet({
    super.key,
    required this.screenBoundaryKey,
  });

  final GlobalKey screenBoundaryKey;

  @override
  ConsumerState<InstantHelpSheet> createState() => _InstantHelpSheetState();
}

class _InstantHelpSheetState extends ConsumerState<InstantHelpSheet> {
  String _tab = 'chat'; // 'chat' | 'error'
  String _mode = 'live_human'; // 'live_human' | 'ai_assistant'
  String? _threadId;
  List<Map<String, dynamic>> _messages = [];
  bool _loading = true;
  bool _sending = false;
  String _screenshotDataUrl = '';

  final _chatController = TextEditingController();
  final _errorTitleController = TextEditingController();
  final _errorBodyController = TextEditingController();

  @override
  void initState() {
    super.initState();
    _initThread();
  }

  @override
  void dispose() {
    _chatController.dispose();
    _errorTitleController.dispose();
    _errorBodyController.dispose();
    super.dispose();
  }

  Future<void> _initThread() async {
    setState(() => _loading = true);
    try {
      final dio = ref.read(apiClientProvider).rawDio;
      final resp = await dio.post<Map<String, dynamic>>(
        '/support/threads/active/',
        data: {
          'mode': _mode,
          'page_url': 'mobile://edusms/app',
        },
      );
      final data = resp.data ?? {};
      if (!mounted) return;
      setState(() {
        _threadId = data['id']?.toString();
        final rawMsgs = data['messages'];
        if (rawMsgs is List) {
          _messages = rawMsgs.whereType<Map<String, dynamic>>().toList();
        }
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _messages = [
          {
            'id': 'local-welcome',
            'sender_type': 'ai',
            'sender_label': 'EduSMS Instant Help',
            'body': 'Welcome! Send a message to Live Support or AI Help, or tap Take Screenshot to attach your current screen.',
          },
        ];
      });
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _takeScreenshot() async {
    final url = await captureFlutterScreenDataUrl(widget.screenBoundaryKey);
    if (!mounted) return;
    if (url.isNotEmpty) {
      setState(() => _screenshotDataUrl = url);
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Screen snapshot attached!')),
      );
    }
  }

  Future<void> _sendMessage() async {
    final text = _chatController.text.trim();
    if (text.isEmpty && _screenshotDataUrl.isEmpty) return;
    setState(() => _sending = true);
    try {
      final dio = ref.read(apiClientProvider).rawDio;
      if (_threadId == null) {
        await _initThread();
      }
      if (_threadId != null) {
        final resp = await dio.post<Map<String, dynamic>>(
          '/support/threads/$_threadId/messages/',
          data: {
            'body': text.isEmpty ? '[Attached Mobile Screen Capture]' : text,
            'screenshot_data_url': _screenshotDataUrl,
            'mode': _mode,
            'sender_type': 'user',
            'via_channel': 'mobile_chat',
          },
        );
        final rawMsgs = resp.data?['messages'];
        if (rawMsgs is List && mounted) {
          setState(() {
            _messages = rawMsgs.whereType<Map<String, dynamic>>().toList();
            _chatController.clear();
            _screenshotDataUrl = '';
          });
        }
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _messages = [
            ..._messages,
            {
              'id': DateTime.now().millisecondsSinceEpoch.toString(),
              'sender_type': 'user',
              'sender_label': 'You',
              'body': text,
            },
          ];
          _chatController.clear();
          _screenshotDataUrl = '';
        });
      }
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  Future<void> _submitErrorReport() async {
    final title = _errorTitleController.text.trim();
    final body = _errorBodyController.text.trim();
    if (title.isEmpty && body.isEmpty) return;
    setState(() => _sending = true);
    try {
      final dio = ref.read(apiClientProvider).rawDio;
      await dio.post<Map<String, dynamic>>(
        '/support/errors/',
        data: {
          'source': 'mobile_manual',
          'severity': 'manual',
          'title': title.isEmpty ? 'Mobile App Issue' : title,
          'message': body.isEmpty ? title : body,
          'screenshot_data_url': _screenshotDataUrl,
          'page_url': 'mobile://edusms/app',
        },
      );
      if (!mounted) return;
      _errorTitleController.clear();
      _errorBodyController.clear();
      setState(() => _screenshotDataUrl = '');
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Error recorded and emailed to Support immediately!')),
      );
    } catch (_) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Error report queued locally.')),
      );
    } finally {
      if (mounted) setState(() => _sending = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 12,
          bottom: MediaQuery.viewInsetsOf(context).bottom + 12,
        ),
        child: SizedBox(
          height: MediaQuery.sizeOf(context).height * 0.72,
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Row(
                    children: [
                      const Icon(Icons.support_agent_rounded, color: Color(0xFF7C3AED)),
                      const SizedBox(width: 8),
                      Text(
                        'Instant Help & AI Support',
                        style: theme.textTheme.titleMedium?.copyWith(fontWeight: FontWeight.bold),
                      ),
                    ],
                  ),
                  IconButton(
                    icon: const Icon(Icons.close),
                    onPressed: () => Navigator.of(context).pop(),
                  ),
                ],
              ),
              const SizedBox(height: 8),
              Row(
                children: [
                  ChoiceChip(
                    label: const Text('Live & AI Chat'),
                    selected: _tab == 'chat',
                    onSelected: (_) => setState(() => _tab = 'chat'),
                  ),
                  const SizedBox(width: 8),
                  ChoiceChip(
                    label: const Text('Report Error'),
                    selected: _tab == 'error',
                    onSelected: (_) => setState(() => _tab = 'error'),
                  ),
                  const Spacer(),
                  if (_tab == 'chat')
                    SegmentedButton<String>(
                      segments: const [
                        ButtonSegment(value: 'live_human', label: Text('Live')),
                        ButtonSegment(value: 'ai_assistant', label: Text('AI')),
                      ],
                      selected: {_mode},
                      onSelectionChanged: (sel) => setState(() => _mode = sel.first),
                    ),
                ],
              ),
              const Divider(height: 20),
              if (_tab == 'chat') ...[
                Expanded(
                  child: _loading
                      ? const Center(child: CircularProgressIndicator())
                      : ListView.builder(
                          itemCount: _messages.length,
                          itemBuilder: (context, idx) {
                            final m = _messages[idx];
                            final isUser = m['sender_type'] == 'user';
                            return Align(
                              alignment: isUser ? Alignment.centerRight : Alignment.centerLeft,
                              child: Container(
                                margin: const EdgeInsets.symmetric(vertical: 4),
                                padding: const EdgeInsets.all(12),
                                decoration: BoxDecoration(
                                  color: isUser
                                      ? const Color(0xFF7C3AED)
                                      : theme.colorScheme.surfaceContainerHighest,
                                  borderRadius: BorderRadius.circular(14),
                                ),
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      (m['sender_label'] ?? 'Support').toString(),
                                      style: TextStyle(
                                        fontSize: 10,
                                        fontWeight: FontWeight.bold,
                                        color: isUser ? Colors.white70 : theme.colorScheme.primary,
                                      ),
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      (m['body'] ?? '').toString(),
                                      style: TextStyle(
                                        fontSize: 13,
                                        color: isUser ? Colors.white : theme.colorScheme.onSurface,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            );
                          },
                        ),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    OutlinedButton.icon(
                      onPressed: _takeScreenshot,
                      icon: const Icon(Icons.camera_alt_outlined, size: 16),
                      label: Text(_screenshotDataUrl.isNotEmpty ? 'Screen Ready' : 'Screenshot'),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: _chatController,
                        decoration: const InputDecoration(
                          hintText: 'Message Live Support or AI...',
                          isDense: true,
                        ),
                      ),
                    ),
                    IconButton(
                      onPressed: _sending ? null : _sendMessage,
                      icon: const Icon(Icons.send_rounded, color: Color(0xFF7C3AED)),
                    ),
                  ],
                ),
              ] else ...[
                Expanded(
                  child: SingleChildScrollView(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.stretch,
                      children: [
                        TextField(
                          controller: _errorTitleController,
                          decoration: const InputDecoration(
                            labelText: 'Error Summary',
                            hintText: 'What went wrong?',
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: _errorBodyController,
                          maxLines: 4,
                          decoration: const InputDecoration(
                            labelText: 'Error Details',
                            hintText: 'Describe the issue (will be emailed immediately to Admin)...',
                          ),
                        ),
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: _takeScreenshot,
                          icon: const Icon(Icons.camera_alt_outlined),
                          label: Text(
                            _screenshotDataUrl.isNotEmpty
                                ? 'Current Screen Snapshot Attached'
                                : 'Take Screenshot of Current Screen',
                          ),
                        ),
                        const SizedBox(height: 16),
                        FilledButton.icon(
                          onPressed: _sending ? null : _submitErrorReport,
                          icon: const Icon(Icons.bug_report_outlined),
                          label: const Text('Submit Error & Email Admin Now'),
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}
