(function ($) {

    const global = this;
    const context = global.testContext && global.testContext.document || global.document;
    const chrome = global.testContext && global.testContext.chrome ? global.testContext.chrome : global.chrome;
    const confirm = global.testContext && global.testContext.confirm ? global.testContext.confirm : global.confirm;

    let currentData;

    $( () => {

        const list = $('#divList', context);
        const header = $('#spnTitle', context);
        const imgMenu = $('#imgMenu', context);
        const imgToggleAll = $('#imgToggleAll', context);
        const divStats = $('#divHeader .stats', context);
        const menu = $('#ulMenu', context);
        const liRestore = $('li[data-command=restore]', menu);
        const liClearAll = $('li[data-command=clearAll]', menu);
        const divFilter = $('#divFilter', context);

        divFilter.find('img').click(() => {
            divFilter.find('input').val('').trigger('change');
        });

        const api = new ApiWrapper(chrome);

        list.listable({
            items: 'li>div:has(a)',
            filter: divFilter.find('input'),
            isEnabled() {
                return !menu.is(':visible');
            }
        }).on('filter', () => {
            refreshRestore();
        });

        imgToggleAll.click(() => {
            toggleAll(list);
        });

        function toggleAll(elem) {
            const inputs = elem.find('input[type=checkbox]:nothidden');
            const checked = inputs.filter(function () {
                return $(this).is(':checked');
            }).length / inputs.length >= 0.5;
            inputs.prop('checked', !checked);
            refreshRestore();
        }

        function createTree(arr, title, time) {
            const div = $('<div></div>').appendTo(list);
            const header = $('<div></div>')
                .addClass('treeHeader')
                .text(title || 'Unknown')
                .click(() => {
                    toggleAll(ul);
                })
                .appendTo(div);
            if (time) header.attr('title', `Deleted on ${new Date(time)}`);
            let ul = $('<ul></ul>').appendTo(div);
            arr.forEach(child => {
                $('<li></li>')
                    .append(createItem(child))
                    .appendTo(ul);
            });
        }

        function refreshRestore() {
            liRestore.toggle(!!list.find('input[type=checkbox]:nothidden:checked').length);
        }

        function createItem(itm) {
            const elem = $('<div></div>');
            if (itm.url) {
                $('<a></a>')
                    .text(itm.title || itm.url)
                    .prepend($('<img/>').addClass('favicon').hideOnError().attr('src', ApiWrapper.getIconForUrl(itm.url)))
                    .attr('href', itm.url || '#')
                    .attr('target', '_blank')
                    .appendTo(elem);
                const chk = $('<input />')
                    .attr('type', 'checkbox')
                    .val(itm.id)
                    .attr('title', 'Mark for delete')
                    .click(function () {
                        $('div.current', list).removeClass('current');
                        $(this).parents('div:first').addClass('current');
                        refreshRestore();
                    })
                    .appendTo(elem);
                chk.data('bookmark', itm);
                elem.click(ev => {
                    if (!chk.is(ev.target)) {
                        chk.click();
                    }
                });
            }
            return elem;
        }

        async function executeMenuCommand(command) {
            switch (command) {
                case 'restore':
                    await restoreBookmarks();
                    await refresh();
                    break;
                case 'clear':
                    await removeBookmarks();
                    await refresh();
                    break;
            }
        }

        let doneTimeout;

        function notifyDone() {
            if (doneTimeout)
                clearTimeout(doneTimeout);
            doneTimeout = setTimeout(async () => {
                await api.notify('Bookmarks restored');
                await refresh();
            }, 500);
        }

        async function removeBookmarks() {
            let items = list.find('input[type=checkbox]:nothidden:checked');
            if (!confirm(`Are you sure you want to permanently remove ${items.length} bookmarks?`))
                return;

            let bookmarks = [];
            list.find('ul').each(function () {
                const ul = $(this);
                items = ul.find('input[type=checkbox]:nothidden:checked');
                bookmarks = bookmarks.concat(items.get().map(itm => $(itm).data('bookmark')));
            });
            const ids = bookmarks.map(bm => bm.id);
            return await api.removeDeletedBookmarksByIds(ids);
        }

        async function restoreBookmarks() {
            let items = list.find('input[type=checkbox]:nothidden:checked');
            if (!confirm(`Are you sure you want to restore ${items.length} bookmarks?`))
                return;

            let bookmarks = [];
            list.find('ul').each(function () {
                const ul = $(this);
                items = ul.find('input[type=checkbox]:nothidden:checked');
                bookmarks = bookmarks.concat(items.get().map(itm => $(itm).data('bookmark')));
            });

            let newFolder = false;
            let parentIds = {};
            bookmarks.forEach(bm => {
                if (bm.parentId)
                    parentIds[bm.parentId] = true;
            });
            parentIds = Object.keys(parentIds);
            const parentBookmarks = await api.getBookmarksByIds(parentIds);
            if (!parentBookmarks || parentBookmarks.filter(bm => !!bm).length != parentIds.length) {
                const bar = await api.getBookmarksBar();
                if (!newFolder) {
                    newFolder = true;
                    await api.notify('Some parent bookmarks are missing, restoring in new folder on the bookmarks bar.');
                }
                const parent = await api.createBookmarks({
                    title: 'Undeleted items',
                    parentId: bar.id
                });
                bookmarks.forEach(bm => {
                    bm.parentId = parent.id;
                });
            }
            const ids = bookmarks.map(bm => bm.id);
            await api.createBookmarks(bookmarks);
            const bms = await api.removeDeletedBookmarksByIds(ids)
            notifyDone(bms);
        }

        menu.contextMenu({
            anchor: imgMenu,
            executeCommand: executeMenuCommand
        });

        function refreshStats(stats) {
            divStats.text(`(${stats.count} items in ${Math.round(stats.size / 102.4) / 10} KB)`);
        }

        async function refresh() {
            $(context).trigger('refresh');
            list.empty();
            const stats = {
                count: 0,
                size: 0
            };
            const bookmarks = await api.getDeletedBookmarks();
            const size = await api.getDeletedBookmarksSize();
            stats.size = size;
            refreshStats(stats);
            if (!bookmarks?.length) {
                imgMenu.hide();
                imgToggleAll.hide();
                liRestore.hide();
                liClearAll.hide();
                header.text('No deleted bookmarks found');
                divFilter.hide();
                return;
            }
            imgMenu.show();
            imgToggleAll.show();
            liRestore.hide();
            liClearAll.show();
            divFilter.show();
            header.text('Deleted bookmarks');
            bookmarks.reverse().forEach(async (obj, idx) => {
                const bms = obj.length ? obj : obj.items;
                stats.count += bms.length;
                const parents = await api.getBookmarksByIds(bms.map(bm => bm.parentId));
                const title = parents.length ? parents[0].title : 'Unknown folder';
                createTree(bms, title, obj.time);
                if (idx == 0) list.trigger('filter');
            })
        }

        let refreshTimeout = null;
        if (api.onRemovedBookmark) {
            api.onRemovedBookmark(() => {
                if (refreshTimeout) clearTimeout(refreshTimeout);
                refreshTimeout = setTimeout(refresh, 1000);
            });
        }
        refresh();


    });

})(jQuery);