import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/theme/app_theme.dart';
import '../../core/widgets/empty_state_view.dart';
import '../../core/widgets/glow_card.dart';
import '../../core/widgets/loading_skeleton.dart';
import '../../data/models/contact_models.dart';
import '../../data/repositories/contacts_repository.dart';
import 'effective_policy_sheet.dart';

class ContactsScreen extends ConsumerStatefulWidget {
  const ContactsScreen({super.key});

  @override
  ConsumerState<ContactsScreen> createState() => _ContactsScreenState();
}

class _ContactsScreenState extends ConsumerState<ContactsScreen>
    with SingleTickerProviderStateMixin {
  late final TabController _tabController = TabController(length: 3, vsync: this);
  final _searchCtrl = TextEditingController();

  List<ContactItem> _contacts = const [];
  List<ContactGroupItem> _groups = const [];
  List<SuppressionItem> _suppressions = const [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    Future.microtask(_loadAll);
  }

  @override
  void dispose() {
    _tabController.dispose();
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _loadAll() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final repo = ref.read(contactsRepositoryProvider);
      final res = await Future.wait([
        repo.listContacts(search: _searchCtrl.text),
        repo.listGroups(),
        repo.listSuppressions(),
      ]);
      if (!mounted) return;
      setState(() {
        _contacts = res[0] as List<ContactItem>;
        _groups = res[1] as List<ContactGroupItem>;
        _suppressions = res[2] as List<SuppressionItem>;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  String _localNormalizePreview(String raw) {
    final trimmed = raw.trim().replaceAll(' ', '').replaceAll('-', '');
    if (trimmed.isEmpty) return '';
    if (trimmed.startsWith('+')) return trimmed;
    if (trimmed.startsWith('0') && trimmed.length >= 9) {
      return '+255${trimmed.substring(1)}';
    }
    if (trimmed.startsWith('255') && trimmed.length >= 11) {
      return '+$trimmed';
    }
    return '+255$trimmed';
  }

  Future<void> _openCreateContactDialog() async {
    final nameCtrl = TextEditingController();
    final phoneCtrl = TextEditingController();
    var optIn = true;
    String preview = '';
    String? dialogError;

    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: const Text('Add Contact'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (dialogError != null) ...[
                      Text(dialogError!, style: const TextStyle(color: AppTheme.roseDanger)),
                      const SizedBox(height: 8),
                    ],
                    TextField(
                      key: const Key('contact_name_input'),
                      controller: nameCtrl,
                      decoration: const InputDecoration(labelText: 'Full Name'),
                    ),
                    const SizedBox(height: 10),
                    TextField(
                      key: const Key('contact_phone_input'),
                      controller: phoneCtrl,
                      keyboardType: TextInputType.phone,
                      onChanged: (v) {
                        setDialogState(() => preview = _localNormalizePreview(v));
                      },
                      decoration: InputDecoration(
                        labelText: 'Phone Number (07... or +255...)',
                        helperText: preview.isNotEmpty
                            ? 'Normalized E.164 preview: $preview'
                            : 'Default country code: +255 (TZ)',
                      ),
                    ),
                    const SizedBox(height: 8),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Verified SMS Opt-In Consent'),
                      value: optIn,
                      onChanged: (v) => setDialogState(() => optIn = v),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  key: const Key('save_contact_button'),
                  onPressed: () async {
                    if (nameCtrl.text.trim().isEmpty || phoneCtrl.text.trim().isEmpty) {
                      setDialogState(() {
                        dialogError = 'Name and phone number are required.';
                      });
                      return;
                    }
                    try {
                      await ref.read(contactsRepositoryProvider).createContact(
                            name: nameCtrl.text,
                            phoneNumber: phoneCtrl.text,
                            optInStatus: optIn,
                          );
                      if (ctx.mounted) Navigator.of(ctx).pop();
                      _loadAll();
                    } catch (e) {
                      setDialogState(() => dialogError = e.toString());
                    }
                  },
                  child: const Text('Save Contact'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _openCsvImportDialog() async {
    final csvCtrl = TextEditingController(
      text: 'name,phone_number\nAmina Juma,0754100201\nBaraka Mushi,+255754100202',
    );
    var consentConfirmed = false;
    var markOptedIn = true;
    String? validationError;

    await showDialog<void>(
      context: context,
      builder: (ctx) {
        return StatefulBuilder(
          builder: (ctx, setDialogState) {
            return AlertDialog(
              title: const Text('Import Contacts CSV'),
              content: SingleChildScrollView(
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  crossAxisAlignment: CrossAxisAlignment.stretch,
                  children: [
                    if (validationError != null) ...[
                      Text(
                        validationError!,
                        key: const Key('csv_consent_error_text'),
                        style: const TextStyle(color: AppTheme.roseDanger, fontSize: 12.5),
                      ),
                      const SizedBox(height: 8),
                    ],
                    TextField(
                      key: const Key('csv_text_input'),
                      controller: csvCtrl,
                      maxLines: 5,
                      decoration: const InputDecoration(
                        labelText: 'CSV Rows (name,phone_number)',
                      ),
                    ),
                    const SizedBox(height: 8),
                    CheckboxListTile(
                      key: const Key('csv_consent_checkbox'),
                      contentPadding: EdgeInsets.zero,
                      controlAffinity: ListTileControlAffinity.leading,
                      value: consentConfirmed,
                      onChanged: (v) => setDialogState(() {
                        consentConfirmed = v ?? false;
                        validationError = null;
                      }),
                      title: const Text(
                        'I confirm these contacts explicitly consented to receive institutional SMS communications.',
                        style: TextStyle(fontSize: 12.5),
                      ),
                    ),
                    SwitchListTile(
                      contentPadding: EdgeInsets.zero,
                      title: const Text('Mark Imported Contacts Opted-In'),
                      value: markOptedIn,
                      onChanged: (v) => setDialogState(() => markOptedIn = v),
                    ),
                  ],
                ),
              ),
              actions: [
                TextButton(
                  onPressed: () => Navigator.of(ctx).pop(),
                  child: const Text('Cancel'),
                ),
                FilledButton(
                  key: const Key('csv_import_submit_button'),
                  onPressed: () async {
                    if (!consentConfirmed) {
                      setDialogState(() {
                        validationError =
                            'Explicit consent confirmation is required before importing contacts.';
                      });
                      return;
                    }
                    try {
                      await ref.read(contactsRepositoryProvider).importCsv(
                            csvText: csvCtrl.text,
                            consentConfirmed: consentConfirmed,
                            markOptedIn: markOptedIn,
                          );
                      if (ctx.mounted) Navigator.of(ctx).pop();
                      _loadAll();
                    } catch (e) {
                      setDialogState(() => validationError = e.toString());
                    }
                  },
                  child: const Text('Import CSV'),
                ),
              ],
            );
          },
        );
      },
    );
  }

  Future<void> _openCreateGroupDialog() async {
    final nameCtrl = TextEditingController();
    final descCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('New Contact Group'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: nameCtrl,
              decoration: const InputDecoration(labelText: 'Group Name'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: descCtrl,
              decoration: const InputDecoration(labelText: 'Description'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              if (nameCtrl.text.trim().isEmpty) return;
              await ref.read(contactsRepositoryProvider).createGroup(
                    name: nameCtrl.text,
                    description: descCtrl.text,
                  );
              if (ctx.mounted) Navigator.of(ctx).pop();
              _loadAll();
            },
            child: const Text('Create Group'),
          ),
        ],
      ),
    );
  }

  Future<void> _openAddSuppressionDialog() async {
    final phoneCtrl = TextEditingController();
    final notesCtrl = TextEditingController();
    await showDialog<void>(
      context: context,
      builder: (ctx) => AlertDialog(
        title: const Text('Suppress Phone Number'),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TextField(
              controller: phoneCtrl,
              decoration: const InputDecoration(labelText: 'Phone Number (+255...)'),
            ),
            const SizedBox(height: 10),
            TextField(
              controller: notesCtrl,
              decoration: const InputDecoration(labelText: 'Reason / Note'),
            ),
          ],
        ),
        actions: [
          TextButton(onPressed: () => Navigator.of(ctx).pop(), child: const Text('Cancel')),
          FilledButton(
            onPressed: () async {
              if (phoneCtrl.text.trim().isEmpty) return;
              await ref.read(contactsRepositoryProvider).addSuppression(
                    phoneNumber: phoneCtrl.text,
                    notes: notesCtrl.text,
                  );
              if (ctx.mounted) Navigator.of(ctx).pop();
              _loadAll();
            },
            child: const Text('Add Block'),
          ),
        ],
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text('Contacts & Consent'),
        actions: [
          IconButton(
            key: const Key('open_csv_import_button'),
            tooltip: 'Import CSV',
            onPressed: _openCsvImportDialog,
            icon: const Icon(Icons.upload_file_outlined),
          ),
          IconButton(
            key: const Key('open_add_contact_button'),
            tooltip: 'Add Contact',
            onPressed: _openCreateContactDialog,
            icon: const Icon(Icons.person_add_alt_1_outlined),
          ),
        ],
        bottom: TabBar(
          controller: _tabController,
          tabs: const [
            Tab(text: 'Contacts'),
            Tab(text: 'Groups'),
            Tab(text: 'Suppressions'),
          ],
        ),
      ),
      body: _loading
          ? const Padding(padding: EdgeInsets.all(16), child: LoadingSkeleton(count: 4))
          : _error != null
              ? EmptyStateView(
                  icon: Icons.error_outline,
                  title: 'Failed to Load Contacts',
                  subtitle: _error!,
                  actionLabel: 'Retry',
                  onAction: _loadAll,
                )
              : TabBarView(
                  controller: _tabController,
                  children: [
                    _buildContactsTab(),
                    _buildGroupsTab(),
                    _buildSuppressionsTab(),
                  ],
                ),
    );
  }

  Widget _buildContactsTab() {
    return Column(
      children: [
        Padding(
          padding: const EdgeInsets.all(16),
          child: TextField(
            controller: _searchCtrl,
            onSubmitted: (_) => _loadAll(),
            decoration: InputDecoration(
              hintText: 'Search contacts by name or +255 number...',
              prefixIcon: const Icon(Icons.search_rounded),
              suffixIcon: IconButton(
                onPressed: _loadAll,
                icon: const Icon(Icons.arrow_forward_rounded),
              ),
            ),
          ),
        ),
        Expanded(
          child: _contacts.isEmpty
              ? EmptyStateView(
                  icon: Icons.contacts_outlined,
                  title: 'No Contacts Yet',
                  subtitle: 'Add a contact or import a consented CSV roster.',
                  actionLabel: 'Add Contact',
                  onAction: _openCreateContactDialog,
                )
              : ListView.separated(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  itemCount: _contacts.length,
                  separatorBuilder: (_, _) => const SizedBox(height: 10),
                  itemBuilder: (context, idx) {
                    final c = _contacts[idx];
                    return GlowCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Row(
                            children: [
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      c.name,
                                      style: const TextStyle(
                                        fontWeight: FontWeight.w700,
                                        fontSize: 15,
                                      ),
                                    ),
                                    Text(
                                      c.phoneNumber,
                                      style: Theme.of(context).textTheme.bodySmall,
                                    ),
                                  ],
                                ),
                              ),
                              Container(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                decoration: BoxDecoration(
                                  color: (c.optOutStatus
                                          ? AppTheme.roseDanger
                                          : (c.optInStatus
                                              ? AppTheme.emeraldSuccess
                                              : AppTheme.amberWarning))
                                      .withValues(alpha: 0.14),
                                  borderRadius: BorderRadius.circular(999),
                                ),
                                child: Text(
                                  c.optOutStatus
                                      ? 'OPTED OUT'
                                      : (c.optInStatus ? 'OPTED IN' : 'UNVERIFIED'),
                                  style: TextStyle(
                                    fontSize: 10.5,
                                    fontWeight: FontWeight.w700,
                                    color: c.optOutStatus
                                        ? AppTheme.roseDanger
                                        : (c.optInStatus
                                            ? AppTheme.emeraldSuccess
                                            : AppTheme.amberWarning),
                                  ),
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: 10),
                          Wrap(
                            spacing: 8,
                            runSpacing: 6,
                            children: [
                              OutlinedButton.icon(
                                onPressed: () {
                                  showModalBottomSheet<void>(
                                    context: context,
                                    isScrollControlled: true,
                                    builder: (_) => EffectivePolicySheet(
                                      contactId: c.id,
                                      contactName: c.name,
                                    ),
                                  );
                                },
                                icon: const Icon(Icons.policy_outlined, size: 16),
                                label: const Text('Effective Policy'),
                              ),
                              if (c.optOutStatus || !c.optInStatus)
                                OutlinedButton(
                                  onPressed: () async {
                                    await ref
                                        .read(contactsRepositoryProvider)
                                        .optInContact(c.id);
                                    _loadAll();
                                  },
                                  child: const Text('Record Opt-In'),
                                )
                              else
                                OutlinedButton(
                                  onPressed: () async {
                                    await ref
                                        .read(contactsRepositoryProvider)
                                        .optOutContact(c.id);
                                    _loadAll();
                                  },
                                  child: const Text('Opt-Out'),
                                ),
                            ],
                          ),
                        ],
                      ),
                    );
                  },
                ),
        ),
      ],
    );
  }

  Widget _buildGroupsTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        FilledButton.icon(
          onPressed: _openCreateGroupDialog,
          icon: const Icon(Icons.group_add_outlined),
          label: const Text('Create Contact Group'),
        ),
        const SizedBox(height: 12),
        if (_groups.isEmpty)
          const EmptyStateView(
            icon: Icons.groups_outlined,
            title: 'No Contact Groups',
            subtitle: 'Organize students, parents, or staff with group policies.',
          )
        else
          ..._groups.map((g) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GlowCard(
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            '${g.name} (${g.memberCount} members)',
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          if (g.description.isNotEmpty) Text(g.description),
                          Text(
                            'Auto-reply: ${g.allowAutoReply ? "On" : "Off"} • AI: ${g.allowAiReply ? "On" : "Off"}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      tooltip: 'Assign First Contact',
                      onPressed: _contacts.isEmpty
                          ? null
                          : () async {
                              await ref.read(contactsRepositoryProvider).manageGroupMembers(
                                    groupId: g.id,
                                    addContactIds: [_contacts.first.id],
                                  );
                              _loadAll();
                            },
                      icon: const Icon(Icons.person_add_outlined),
                    ),
                    IconButton(
                      onPressed: () async {
                        await ref.read(contactsRepositoryProvider).deleteGroup(g.id);
                        _loadAll();
                      },
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }

  Widget _buildSuppressionsTab() {
    return ListView(
      padding: const EdgeInsets.all(16),
      children: [
        OutlinedButton.icon(
          onPressed: _openAddSuppressionDialog,
          icon: const Icon(Icons.block_rounded),
          label: const Text('Suppress Number Manually'),
        ),
        const SizedBox(height: 12),
        if (_suppressions.isEmpty)
          const EmptyStateView(
            icon: Icons.verified_outlined,
            title: 'Suppression List Empty',
            subtitle: 'Numbers that send STOP or are manually blocked appear here.',
          )
        else
          ..._suppressions.map((s) {
            return Padding(
              padding: const EdgeInsets.only(bottom: 10),
              child: GlowCard(
                accentColor: AppTheme.roseDanger,
                child: Row(
                  children: [
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            s.phoneNumber,
                            style: const TextStyle(fontWeight: FontWeight.w700),
                          ),
                          Text(
                            '${s.reason.toUpperCase()} ${s.notes.isNotEmpty ? "• ${s.notes}" : ""}',
                            style: Theme.of(context).textTheme.bodySmall,
                          ),
                        ],
                      ),
                    ),
                    IconButton(
                      onPressed: () async {
                        await ref.read(contactsRepositoryProvider).deleteSuppression(s.id);
                        _loadAll();
                      },
                      icon: const Icon(Icons.delete_outline),
                    ),
                  ],
                ),
              ),
            );
          }),
      ],
    );
  }
}
